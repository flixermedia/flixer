import { Inject, Injectable, logger } from "@tsed/di";
import { BadRequest } from "@tsed/exceptions";
import { randomUUID } from "node:crypto";
import dns from "node:dns";
import net from "node:net";
import nodemailer from "nodemailer";
import { DataSource, LessThanOrEqual } from "typeorm";
import { DefaultDataSource } from "../../datasources/defaultDataSource.datasource.js";
import { MailMessage } from "../../entities/mailMessage.entity.js";
import { headerSafe, parseAddress } from "./mailAddress.js";
import { MailDomainService } from "./mailDomainService.js";
import { MailInboxService } from "./mailInboxService.js";
import { MailboxService } from "./mailboxService.js";
import { MailSettingsService } from "./mailSettingsService.js";

const RETRY_DELAYS_MINUTES = [5, 15, 60, 240, 720];
const MAX_RECIPIENTS = 20;
const POLL_MS = 30_000;
const CLAIM_MS = 10 * 60_000;

export interface OutgoingMail {
	from: { address: string; name?: string };
	to: string[];
	subject: string;
	text: string;
	html?: string | null;
	/** System mail (noreply) is marked auto-generated so receivers don't auto-reply to it. */
	system?: boolean;
	inReplyTo?: string | null;
	/** Attempt delivery now and throw if it fails, instead of leaving it to the retry queue. */
	wait?: boolean;
}

class PermanentFailure extends Error {}

type RelaySender = (message: { to: string; subject: string; html: string; text: string }) => Promise<void>;

/** Queues outgoing mail and delivers it straight to the recipient's mail server, signed with DKIM. */
@Injectable()
export class MailDeliveryService {

	private relay?: RelaySender;
	private timer?: ReturnType<typeof setInterval>;
	private running = false;
	private readonly resolver = new dns.promises.Resolver({ timeout: 4000, tries: 2 });

	constructor(
		@Inject(DefaultDataSource) private readonly dataSource: DataSource,
		private readonly settings: MailSettingsService,
		private readonly domains: MailDomainService,
		private readonly mailboxes: MailboxService,
		private readonly inbox: MailInboxService,
	) {}

	/** MailService registers the external SMTP relay here so it can serve as the optional fallback. */
	setRelay(sender: RelaySender): void {
		this.relay = sender;
	}

	$onReady(): void {
		this.timer = setInterval(() => void this.processDue(), POLL_MS);
		this.timer.unref();
		void this.processDue();
	}

	$onDestroy(): void {
		clearInterval(this.timer);
	}

	/** The noreply sender, when built-in sending is turned on and its domain is verified. */
	async systemSender(): Promise<{ address: string; name: string } | null> {
		const settings = await this.settings.get();
		if (!settings.outboundEnabled || !settings.noreplyAddress) return null;
		const parsed = parseAddress(settings.noreplyAddress);
		if (!parsed || !(await this.domains.findForHost(parsed.domain, { verifiedOnly: true }))) return null;
		return { address: parsed.address, name: settings.noreplyName };
	}

	async enqueue(mail: OutgoingMail): Promise<MailMessage[]> {
		const sender = parseAddress(mail.from.address);
		if (!sender) throw new BadRequest("The sender address is invalid.");
		const recipients = [...new Set(mail.to.map((value) => parseAddress(value)?.address ?? ""))];
		if (recipients.length === 0 || recipients.includes("")) throw new BadRequest("Enter valid recipient email addresses.");
		if (recipients.length > MAX_RECIPIENTS) throw new BadRequest(`You can send to at most ${MAX_RECIPIENTS} recipients at once.`);
		const subject = headerSafe(mail.subject, 300);
		if (!subject) throw new BadRequest("A subject is required.");
		if (!(await this.domains.findForHost(sender.domain, { verifiedOnly: true }))) {
			throw new BadRequest("The sender's domain isn't verified.");
		}

		const mailbox = await this.mailboxes.findByAddress(sender.address) ?? (mail.system ? await this.mailboxes.ensureSystemMailbox(sender.address) : null);
		if (!mailbox) throw new BadRequest("Send from one of the mailboxes you created.");
		const repo = this.dataSource.getRepository(MailMessage);
		const rows = await repo.save(recipients.map((recipient) => repo.create({
			id: randomUUID(),
			mailboxId: mailbox.id,
			direction: "outbound",
			status: "queued",
			fromAddress: sender.address,
			fromName: mail.from.name ? headerSafe(mail.from.name, 100) : null,
			toAddresses: [recipient],
			subject,
			text: mail.text,
			html: mail.html ?? null,
			messageId: `<${randomUUID()}@${sender.domain}>`,
			attachments: [],
			inReplyTo: mail.inReplyTo ? headerSafe(mail.inReplyTo, 998) : null,
			isSystem: mail.system === true,
			nextAttemptAt: new Date(),
		})));

		if (mail.wait) {
			for (const row of rows) await this.attempt(row);
			const failed = await repo.findBy(rows.map((row) => ({ id: row.id, status: "failed" as const })));
			const pending = await repo.findOneBy({ id: rows[0].id });
			if (failed.length > 0 || pending?.status === "queued") {
				throw new Error(pending?.lastError ?? failed[0]?.lastError ?? "Delivery failed.");
			}
		} else {
			void this.processDue();
		}
		return rows;
	}

	async processDue(): Promise<void> {
		if (this.running) return;
		this.running = true;
		try {
			const repo = this.dataSource.getRepository(MailMessage);
			const due = await repo.find({ where: { status: "queued", nextAttemptAt: LessThanOrEqual(new Date()) }, order: { nextAttemptAt: "ASC" }, take: 10 });
			for (const message of due) {
				const claimed = await repo.update({ id: message.id, status: "queued", nextAttemptAt: LessThanOrEqual(new Date()) }, { nextAttemptAt: new Date(Date.now() + CLAIM_MS) });
				if (claimed.affected) await this.attempt(message);
			}
		} catch (error) {
			logger().warn("Mail queue processing failed.", error);
		} finally {
			this.running = false;
		}
	}

	async diagnostics() {
		const settings = await this.settings.get();
		const result: Record<string, { ok: boolean; detail: string }> = {};

		result.outboundPort25 = await new Promise((resolve) => {
			const socket = net.connect({ host: "gmail-smtp-in.l.google.com", port: 25 });
			const finish = (ok: boolean, detail: string) => {
				socket.destroy();
				resolve({ ok, detail });
			};
			socket.setTimeout(6000, () => finish(false, "Connection to port 25 timed out. Your host or ISP likely blocks outbound port 25."));
			socket.once("connect", () => finish(true, "Outbound port 25 is reachable."));
			socket.once("error", (error: NodeJS.ErrnoException) => finish(false, `Outbound port 25 is blocked (${error.code ?? error.message}).`));
		});

		if (!settings.hostname) {
			result.reverseDns = { ok: false, detail: "Set the server hostname first." };
		} else {
			try {
				const addresses = await this.resolver.resolve4(settings.hostname);
				const names = (await Promise.all(addresses.map((address) => this.resolver.reverse(address).catch(() => [] as string[])))).flat().map((name) => name.toLowerCase());
				const ok = names.includes(settings.hostname);
				result.reverseDns = { ok, detail: ok ? `${addresses.join(", ")} has a matching PTR record.` : `The PTR record for ${addresses.join(", ")} doesn't match ${settings.hostname}. Set it at your hosting provider.` };
			} catch {
				result.reverseDns = { ok: false, detail: `${settings.hostname} has no A record yet.` };
			}
		}
		return result;
	}

	private async attempt(message: MailMessage): Promise<void> {
		const repo = this.dataSource.getRepository(MailMessage);
		const recipient = message.toAddresses[0];
		try {
			await this.deliver(message, recipient);
			await repo.update({ id: message.id }, { status: "sent", sentAt: new Date(), lastError: null, nextAttemptAt: null, attempts: message.attempts + 1 });
			return;
		} catch (error) {
			const reason = error instanceof Error ? error.message : "Unknown delivery error";
			const attempts = message.attempts + 1;
			const permanent = error instanceof PermanentFailure || attempts > RETRY_DELAYS_MINUTES.length;

			if (permanent && (await this.tryRelay(message, recipient))) {
				await repo.update({ id: message.id }, { status: "sent", sentAt: new Date(), attempts, lastError: `Sent through the SMTP relay after direct delivery failed: ${reason}`.slice(0, 1000), nextAttemptAt: null });
				return;
			}
			await repo.update({ id: message.id }, permanent
				? { status: "failed", attempts, lastError: reason.slice(0, 1000), nextAttemptAt: null }
				: { attempts, lastError: reason.slice(0, 1000), nextAttemptAt: new Date(Date.now() + RETRY_DELAYS_MINUTES[attempts - 1] * 60_000) });
		}
	}

	private async tryRelay(message: MailMessage, recipient: string): Promise<boolean> {
		if (!this.relay || !(await this.settings.get()).relayFallback) return false;
		try {
			await this.relay({ to: recipient, subject: message.subject, html: message.html ?? "", text: message.text });
			return true;
		} catch (error) {
			logger().warn("The SMTP relay fallback failed.", error);
			return false;
		}
	}

	private async deliver(message: MailMessage, recipient: string): Promise<void> {
		const sender = parseAddress(message.fromAddress);
		const target = parseAddress(recipient);
		if (!sender || !target) throw new PermanentFailure("Invalid sender or recipient address.");

		const local = await this.mailboxes.findByAddress(target.address);
		if (local && local.kind !== "system" && (await this.domains.findForHost(target.domain, { verifiedOnly: true }))) {
			if (!local.enabled) throw new PermanentFailure("The recipient mailbox is disabled.");
			await this.inbox.store({ mailboxId: local.id, fromAddress: sender.address, fromName: message.fromName, toAddresses: [target.address], subject: message.subject, text: message.text, html: message.html, messageId: message.messageId, authResults: { local: "pass" }, remoteAddress: null, attachments: [], files: [] });
			return;
		}

		const signing = await this.domains.signingKey(sender.domain);
		if (!signing) throw new PermanentFailure("The sender's domain is no longer verified.");
		const settings = await this.settings.get();

		const exchanges = await this.mailExchangers(target.domain);
		let lastError = "No mail server accepted the message.";
		for (const exchange of exchanges.slice(0, 3)) {
			const transport = nodemailer.createTransport({
				host: exchange,
				port: 25,
				secure: false,
				name: settings.hostname ?? undefined,
				tls: { rejectUnauthorized: false, servername: exchange },
				connectionTimeout: 20_000,
				greetingTimeout: 20_000,
				socketTimeout: 60_000,
				dkim: signing,
			});
			try {
				await transport.sendMail({
					envelope: { from: `bounces@${signing.domainName}`, to: [target.address] },
					from: { name: message.fromName ?? "", address: sender.address },
					to: target.address,
					subject: message.subject,
					text: message.text,
					html: message.html ?? undefined,
					messageId: message.messageId ?? undefined,
					inReplyTo: message.inReplyTo ?? undefined,
					references: message.inReplyTo ?? undefined,
					headers: message.isSystem ? { "Auto-Submitted": "auto-generated", "X-Auto-Response-Suppress": "All" } : undefined,
				});
				return;
			} catch (error) {
				const code = (error as { responseCode?: number }).responseCode;
				lastError = `${exchange}: ${error instanceof Error ? error.message : String(error)}`;
				if (code && code >= 500 && code < 600) throw new PermanentFailure(lastError);
			} finally {
				transport.close();
			}
		}
		throw new Error(lastError);
	}

	private async mailExchangers(domain: string): Promise<string[]> {
		const records = await this.resolver.resolveMx(domain).catch(() => [] as dns.MxRecord[]);
		if (records.length === 0) return [domain];
		return records.sort((a, b) => a.priority - b.priority).map((record) => record.exchange.replace(/\.$/, ""));
	}
}
