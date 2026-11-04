import { Inject, Injectable, logger } from "@tsed/di";
import { BadRequest, Conflict, NotFound } from "@tsed/exceptions";
import { randomBytes, randomUUID } from "node:crypto";
import { DataSource, IsNull } from "typeorm";
import { DefaultDataSource } from "../../datasources/defaultDataSource.datasource.js";
import { Mailbox, type MailboxKind } from "../../entities/mailbox.entity.js";
import { User } from "../../entities/user.entity.js";
import { normalizeLocalPart, parseAddress } from "./mailAddress.js";
import { MailDomainService } from "./mailDomainService.js";
import { MailSettingsService } from "./mailSettingsService.js";

const RESERVED_LOCAL_PARTS = new Set(["postmaster", "abuse", "hostmaster", "webmaster", "mailer-daemon"]);

function randomLocal(): string {
	return randomBytes(8).toString("hex");
}

/** Slug of a username that is safe as an address local part; null when nothing usable remains. */
export function usernameLocalPart(username: string): string | null {
	const slug = username.toLowerCase().replace(/[^a-z0-9._+-]+/g, "-").replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "").replace(/\.{2,}/g, ".").slice(0, 48);
	return normalizeLocalPart(slug);
}

/** Admin-created inboxes, the noreply system mailbox and per-user addresses. */
@Injectable()
export class MailboxService {

	constructor(
		@Inject(DefaultDataSource) private readonly dataSource: DataSource,
		private readonly domains: MailDomainService,
		private readonly settings: MailSettingsService,
	) {}

	private get repo() {
		return this.dataSource.getRepository(Mailbox);
	}

	async list() {
		const rows = await this.dataSource.query(
			`SELECT m.id, m.address, m.kind, m.display_name AS "displayName", m.user_id AS "userId", m.enabled, m.created_at AS "createdAt",
				u.username AS "username",
				COUNT(msg.id) FILTER (WHERE msg.direction = 'inbound') AS "received",
				COUNT(msg.id) FILTER (WHERE msg.direction = 'outbound') AS "sent",
				COUNT(msg.id) FILTER (WHERE msg.direction = 'inbound' AND msg.read_at IS NULL) AS "unread"
			FROM mailboxes m
			LEFT JOIN users u ON u.id = m.user_id
			LEFT JOIN mail_messages msg ON msg.mailbox_id = m.id
			GROUP BY m.id, u.username
			ORDER BY m.kind = 'system' DESC, m.address ASC`,
		);
		return (rows as Array<Record<string, unknown>>).map((row) => ({ ...row, received: Number(row.received), sent: Number(row.sent), unread: Number(row.unread) }));
	}

	async get(id: string): Promise<Mailbox> {
		const mailbox = await this.repo.findOneBy({ id });
		if (!mailbox) throw new NotFound("Mailbox not found.");
		return mailbox;
	}

	findByAddress(address: string): Promise<Mailbox | null> {
		return this.repo.findOneBy({ address });
	}

	async create(input: { address: string; displayName?: string | null }): Promise<Mailbox> {
		const parsed = parseAddress(input.address);
		if (!parsed) throw new BadRequest("Enter a valid email address.");
		if (RESERVED_LOCAL_PARTS.has(parsed.local)) throw new BadRequest(`The address ${parsed.local}@ is reserved.`);
		if (!(await this.domains.findForHost(parsed.domain, { verifiedOnly: true }))) {
			throw new BadRequest("This address isn't on a verified domain. Add and verify the domain first.");
		}
		if (await this.repo.existsBy({ address: parsed.address })) throw new Conflict("That address already exists.");
		return this.repo.save(this.repo.create({
			id: randomUUID(),
			address: parsed.address,
			kind: "inbox",
			displayName: input.displayName?.trim().slice(0, 100) || null,
			userId: null,
			enabled: true,
		}));
	}

	async update(id: string, input: { displayName?: string | null; enabled?: boolean }): Promise<Mailbox> {
		const mailbox = await this.get(id);
		if (input.displayName !== undefined) mailbox.displayName = input.displayName?.replace(/[\r\n\0]/g, " ").trim().slice(0, 100) || null;
		if (input.enabled !== undefined) mailbox.enabled = input.enabled === true;
		return this.repo.save(mailbox);
	}

	async remove(id: string): Promise<void> {
		const mailbox = await this.get(id);
		await this.repo.delete({ id: mailbox.id });
	}

	/** Makes sure the sender address exists as a (send-only) mailbox so its sent mail can be browsed. */
	async ensureSystemMailbox(address: string): Promise<Mailbox> {
		const existing = await this.repo.findOneBy({ address });
		if (existing) return existing;
		return this.repo.save(this.repo.create({ id: randomUUID(), address, kind: "system" as MailboxKind, displayName: "System", userId: null, enabled: true }));
	}

	async forUser(userId: string): Promise<Mailbox | null> {
		return this.repo.findOneBy({ userId });
	}

	/** Creates the user's address when the feature is on. Returns null when it's off or can't be created. */
	async ensureUserMailbox(user: Pick<User, "id" | "username">): Promise<Mailbox | null> {
		const settings = await this.settings.get();
		if (!settings.userAddressesEnabled || !settings.userAddressDomain) return null;
		const existing = await this.forUser(user.id);
		if (existing) return existing;
		if (!(await this.domains.findForHost(settings.userAddressDomain, { verifiedOnly: true }))) {
			logger().warn(`User addresses are on but ${settings.userAddressDomain} isn't a verified mail domain.`);
			return null;
		}

		const candidates: string[] = [];
		const base = settings.userAddressMode === "username" ? usernameLocalPart(user.username) : null;
		if (base && !RESERVED_LOCAL_PARTS.has(base)) candidates.push(base, `${base.slice(0, 40)}-${randomBytes(2).toString("hex")}`);
		candidates.push(randomLocal(), randomLocal());

		for (const local of candidates) {
			const address = `${local}@${settings.userAddressDomain}`;
			try {
				return await this.repo.save(this.repo.create({ id: randomUUID(), address, kind: "user", displayName: null, userId: user.id, enabled: true }));
			} catch (error) {
				const raced = await this.forUser(user.id);
				if (raced) return raced;
				if ((error as { code?: string }).code !== "23505") throw error;
			}
		}
		return null;
	}

	/** Creates addresses for every enabled user that doesn't have one yet. */
	async generateForAllUsers(): Promise<{ created: number }> {
		const settings = await this.settings.get();
		if (!settings.userAddressesEnabled) throw new BadRequest("Turn on user addresses first.");
		const users = await this.dataSource.getRepository(User).find({ where: { disabledAt: IsNull() }, select: { id: true, username: true } });
		let created = 0;
		for (const user of users) {
			if (await this.forUser(user.id)) continue;
			if (await this.ensureUserMailbox(user)) created += 1;
		}
		return { created };
	}
}
