import { Inject, Injectable, logger } from "@tsed/di";
import { DataSource, In } from "typeorm";
import { DefaultDataSource } from "../../datasources/defaultDataSource.datasource.js";
import { MediaItem } from "../../entities/mediaItem.entity.js";
import type { PluginInstallation } from "../../entities/pluginInstallation.entity.js";
import { PluginSecret } from "../../entities/pluginSecret.entity.js";
import { User } from "../../entities/user.entity.js";
import { NotificationService } from "../notifications/notificationService.js";
import { DATABASE_PERMISSION, PluginDatabaseError, PluginDatabaseService } from "./pluginDatabaseService.js";
import type { HostCall, HostResult } from "./pluginHostCalls.js";
import { decryptPluginSettingSecret, encryptPluginSettingSecret } from "./pluginSettingsSecrets.js";

const SECRET_NAME = /^[a-zA-Z0-9_.:-]{1,128}$/;
const MAX_SECRET_BYTES = 64 * 1024;
const MAX_USER_IDS = 100;
const MAX_CARDS = 60;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const PERMISSION_OF: Record<string, string> = {
	"db.find": DATABASE_PERMISSION,
	"db.count": DATABASE_PERMISSION,
	"db.insert": DATABASE_PERMISSION,
	"db.update": DATABASE_PERMISSION,
	"db.delete": DATABASE_PERMISSION,
	"secret.set": "secrets.manage",
	"secret.get": "secrets.manage",
	"users.get": "users.read",
	"users.list": "users.read",
	"library.match": "library.read",
	"notify.send": "notifications.send",
};

export const HOST_SERVICE_OPS = new Set(Object.keys(PERMISSION_OF));

interface MatchCard {
	key: string;
	type: "movie" | "tv" | "music";
	source: string;
	id: string;
	title: string;
	year: number | null;
}

const LIBRARY_TYPE = { movie: "movie", tv: "series", music: "album" } as const;

/** Lowercase letters and digits only, so titles compare equal across punctuation and spacing. */
export function normalizeTitle(value: string): string {
	return value
		.normalize("NFKD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Host calls that reach Flixer's own data on a plugin's behalf, each behind an approved permission. */
@Injectable()
export class PluginHostService {
	constructor(
		@Inject(DefaultDataSource) private readonly dataSource: DataSource,
		private readonly database: PluginDatabaseService,
		private readonly notifications: NotificationService,
	) {}

	async handle(installation: PluginInstallation, approved: ReadonlySet<string>, call: HostCall): Promise<HostResult> {
		const permission = PERMISSION_OF[call.op];
		if (!permission) return { id: call.id, ok: false, error: "invalid_request" };
		if (!approved.has(permission) || !installation.manifest.permissions.includes(permission)) {
			return { id: call.id, ok: false, error: "permission_denied" };
		}
		try {
			if (call.op.startsWith("db.")) {
				return { id: call.id, ok: true, ...(await this.database.execute(installation, call)) };
			}
			switch (call.op) {
				case "secret.set":
					return { id: call.id, ok: true, ...(await this.setSecret(installation.pluginId, call)) };
				case "secret.get":
					return await this.getSecret(installation.pluginId, call);
				case "users.get":
					return { id: call.id, ok: true, users: await this.usersByIds(call) };
				case "users.list":
					return { id: call.id, ok: true, ...(await this.listUsers(call)) };
				case "library.match":
					return { id: call.id, ok: true, matches: await this.matchLibrary(call) };
				default:
					await this.notify(call);
					return { id: call.id, ok: true };
			}
		} catch (error: unknown) {
			if (error instanceof PluginDatabaseError) return { id: call.id, ok: false, error: error.code };
			if (error instanceof HostInputError) return { id: call.id, ok: false, error: "invalid_request" };
			logger().warn(`Plugin ${installation.pluginId} host call ${call.op} failed.`, error);
			return { id: call.id, ok: false, error: "request_failed" };
		}
	}

	private async setSecret(pluginId: string, call: HostCall) {
		if (typeof call.name !== "string" || !SECRET_NAME.test(call.name) || typeof call.value !== "string") {
			throw new HostInputError();
		}
		const repository = this.dataSource.getRepository(PluginSecret);
		if (call.value === "") {
			await repository.delete({ pluginId, name: call.name });
			return {};
		}
		if (Buffer.byteLength(call.value) > MAX_SECRET_BYTES) throw new HostInputError();
		await repository.save({ pluginId, name: call.name, value: encryptPluginSettingSecret(pluginId, `secret:${call.name}`, call.value) });
		return {};
	}

	private async getSecret(pluginId: string, call: HostCall): Promise<HostResult> {
		if (typeof call.name !== "string" || !SECRET_NAME.test(call.name)) throw new HostInputError();
		const row = await this.dataSource.getRepository(PluginSecret).findOneBy({ pluginId, name: call.name });
		if (!row) return { id: call.id, ok: false, error: "not_found" };
		return { id: call.id, ok: true, value: decryptPluginSettingSecret(pluginId, `secret:${call.name}`, row.value) };
	}

	private publicUser(user: User) {
		return { id: user.id, username: user.username, displayName: user.displayName, role: user.role };
	}

	private async usersByIds(call: HostCall) {
		const ids = call.ids;
		if (!Array.isArray(ids) || ids.length > MAX_USER_IDS || !ids.every((id) => typeof id === "string" && UUID.test(id))) {
			throw new HostInputError();
		}
		if (ids.length === 0) return [];
		const users = await this.dataSource
			.getRepository(User)
			.find({ where: { id: In(ids.map((id: string) => id.toLowerCase())) } });
		return users.map((user) => this.publicUser(user));
	}

	private async listUsers(call: HostCall) {
		const limit = call.limit === undefined ? 50 : call.limit;
		const offset = call.offset === undefined ? 0 : call.offset;
		if (!Number.isInteger(limit) || (limit as number) < 1 || (limit as number) > 200) throw new HostInputError();
		if (!Number.isInteger(offset) || (offset as number) < 0) throw new HostInputError();
		const [users, total] = await this.dataSource.getRepository(User).findAndCount({
			order: { username: "ASC" },
			take: limit as number,
			skip: offset as number,
		});
		return { total, users: users.map((user) => this.publicUser(user)) };
	}

	private parseCards(call: HostCall): MatchCard[] {
		if (!Array.isArray(call.cards) || call.cards.length > MAX_CARDS) throw new HostInputError();
		return call.cards.map((raw: unknown) => {
			if (
				!isRecord(raw) ||
				typeof raw.key !== "string" ||
				(raw.type !== "movie" && raw.type !== "tv" && raw.type !== "music") ||
				typeof raw.source !== "string" ||
				typeof raw.id !== "string" ||
				typeof raw.title !== "string" ||
				(raw.year !== null && raw.year !== undefined && !Number.isInteger(raw.year))
			) {
				throw new HostInputError();
			}
			return {
				key: raw.key,
				type: raw.type,
				source: raw.source,
				id: raw.id,
				title: raw.title.slice(0, 300),
				year: typeof raw.year === "number" ? raw.year : null,
			};
		});
	}

	/** Maps each card key to the library item that already holds the title, by provider id or else by title and year. */
	private async matchLibrary(call: HostCall): Promise<Record<string, string>> {
		const cards = this.parseCards(call);
		const matches: Record<string, string> = {};
		if (cards.length === 0) return matches;
		const repository = this.dataSource.getRepository(MediaItem);

		const keyed = await repository.find({
			select: { id: true, externalKey: true, type: true },
			where: { externalKey: In(cards.map((card) => `${card.source}:${card.id}`)), isPlaceholder: false },
		});
		for (const item of keyed) {
			const card = cards.find(
				(entry) => `${entry.source}:${entry.id}` === item.externalKey && LIBRARY_TYPE[entry.type] === item.type,
			);
			if (card) matches[card.key] = item.id;
		}

		const unmatched = cards.filter((card) => !matches[card.key]);
		if (unmatched.length === 0) return matches;
		const titles = [...new Set(unmatched.map((card) => card.title.toLowerCase()))];
		const candidates = await repository
			.createQueryBuilder("item")
			.select(["item.id", "item.type", "item.title", "item.year"])
			.where("item.is_placeholder = false")
			.andWhere("item.type IN (:...types)", { types: ["movie", "series", "album"] })
			.andWhere("lower(item.title) IN (:...titles)", { titles })
			.getMany();
		for (const card of unmatched) {
			const wanted = normalizeTitle(card.title);
			const found = candidates.find((item) => {
				if (item.type !== LIBRARY_TYPE[card.type] || normalizeTitle(item.title) !== wanted) return false;
				return (
					card.type === "music" ||
					card.year === null ||
					item.year === null ||
					Math.abs(item.year - card.year) <= 1
				);
			});
			if (found) matches[card.key] = found.id;
		}
		return matches;
	}

	private async notify(call: HostCall): Promise<void> {
		if (
			(call.to !== "user" && call.to !== "admins") ||
			typeof call.title !== "string" ||
			typeof call.message !== "string" ||
			call.title.length === 0 ||
			(call.url !== undefined && (typeof call.url !== "string" || !call.url.startsWith("/") || call.url.startsWith("//")))
		) {
			throw new HostInputError();
		}
		let recipients: string[];
		if (call.to === "user") {
			if (typeof call.userId !== "string" || !UUID.test(call.userId)) throw new HostInputError();
			recipients = [call.userId.toLowerCase()];
		} else {
			const admins = await this.dataSource.getRepository(User).find({ select: { id: true }, where: { role: "admin" } });
			recipients = admins.map((admin) => admin.id);
		}
		if (recipients.length === 0) return;
		await this.notifications.send(
			{ title: call.title.slice(0, 120), body: call.message.slice(0, 500), url: call.url ?? null, kind: "request" },
			recipients,
		);
	}
}

class HostInputError extends Error {}
