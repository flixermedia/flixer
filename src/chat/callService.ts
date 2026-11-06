import { createHash, createHmac } from "node:crypto";
import { Inject, Injectable } from "@tsed/di";
import { Conflict, Forbidden, NotFound } from "@tsed/exceptions";
import { DataSource } from "typeorm";
import { appConfig } from "../config/store/appConfig.js";
import { PartiesService } from "../party/partiesService.js";
import { DefaultDataSource } from "../datasources/defaultDataSource.datasource.js";

const CREDENTIAL_TTL_SECONDS = 6 * 60 * 60;

export interface PartyKeyPackage {
	userId: string;
	deviceId: string;
	keyPackageId: string;
	keyPackage: string;
	available: boolean;
}

export interface IceServer {
	urls: string[];
	username?: string;
	credential?: string;
}

export interface IceConfig {
	iceServers: IceServer[];
	relayOnly: boolean;
}

/**
 * The relay secret used when an admin has not entered one. The bundled coturn service derives the same value from the
 * shared app-secret file, so it needs no separate configuration.
 */
export function derivedTurnSecret(appSecret: string): string {
	return createHash("sha256").update(`flixer:calls-turn:v1:${appSecret}`).digest("hex");
}

/**
 * Supplies what clients need to place peer-to-peer calls. Media and call keys never touch the server: it only hands
 * out STUN/TURN settings and checks who may signal whom.
 */
@Injectable()
export class CallService {
	constructor(
		@Inject(DefaultDataSource) private readonly dataSource: DataSource,
		private readonly parties: PartiesService,
	) {}

	async isEnabled(): Promise<boolean> {
		return (await this.setting("calls_enabled")) === true;
	}

	/** Returns the other members of a conversation the user belongs to; throws when calls are off or the user isn't a member. */
	async recipients(userId: string, conversationId: string): Promise<string[]> {
		if (!(await this.isEnabled())) {
			throw new Forbidden("Calls are disabled on this server.");
		}
		const rows = (await this.dataSource.query(
			`SELECT user_id FROM chat_members WHERE conversation_id = $1`,
			[conversationId],
		)) as Array<{ user_id: string }>;
		const ids = rows.map((row) => row.user_id);
		if (!ids.includes(userId)) {
			throw new NotFound("Conversation not found.");
		}
		return ids.filter((id) => id !== userId);
	}

	/** Key packages of the caller's and one peer's active devices, for starting an encrypted voice link inside a party. */
	async partyKeyPackages(userId: string, partyId: string, peerId: string, lenient = false): Promise<PartyKeyPackage[]> {
		await this.assertPartyMembers(partyId, [userId, peerId]);
		const rows = (await this.dataSource.query(
			`SELECT d.user_id, d.id AS device_id, k.id AS key_package_id, k.key_package, (k.used_at IS NULL) AS available
			FROM chat_mls_devices d JOIN chat_mls_key_packages k ON k.device_id = d.id
			WHERE d.status = 'active' AND d.user_id = ANY($1::uuid[])
			ORDER BY d.user_id, d.created_at, k.created_at`,
			[[userId, peerId]],
		)) as Array<{ user_id: string; device_id: string; key_package_id: string; key_package: string; available: boolean }>;
		const devices = new Map<string, boolean>();
		for (const row of rows) {
			devices.set(row.device_id, (devices.get(row.device_id) ?? false) || row.available);
		}
		const users = new Set(rows.map((row) => row.user_id));
		if (!users.has(peerId) || (!lenient && [...devices.values()].some((available) => !available))) {
			throw new Conflict("Every active chat device needs an unused MLS key package. Ask each member to open Flixer and try again.");
		}
		return rows.map((row) => ({
			userId: row.user_id,
			deviceId: row.device_id,
			keyPackageId: row.key_package_id,
			keyPackage: row.key_package,
			available: row.available,
		}));
	}

	async claimPartyKeyPackage(userId: string, partyId: string, keyPackageId: string): Promise<PartyKeyPackage & { available: false }> {
		const owner = (await this.dataSource.query(
			`SELECT d.user_id FROM chat_mls_key_packages k JOIN chat_mls_devices d ON d.id = k.device_id WHERE k.id = $1`,
			[keyPackageId],
		)) as Array<{ user_id: string }>;
		if (!owner[0]) {
			throw new Conflict("That MLS key package was already used or is no longer available.");
		}
		await this.assertPartyMembers(partyId, [userId, owner[0].user_id]);
		const rows = (await this.dataSource.query(
			`UPDATE chat_mls_key_packages k SET used_at = now()
			FROM chat_mls_devices d
			WHERE k.id = $1 AND k.device_id = d.id AND d.status = 'active' AND k.used_at IS NULL
			RETURNING d.user_id, d.id AS device_id, k.id AS key_package_id, k.key_package`,
			[keyPackageId],
		)) as Array<{ user_id: string; device_id: string; key_package_id: string; key_package: string }>;
		const row = rows[0];
		if (!row) {
			throw new Conflict("That MLS key package was already used or is no longer available.");
		}
		return { userId: row.user_id, deviceId: row.device_id, keyPackageId: row.key_package_id, keyPackage: row.key_package, available: false };
	}

	private async assertPartyMembers(partyId: string, userIds: string[]): Promise<void> {
		if (!(await this.isEnabled())) {
			throw new Forbidden("Calls are disabled on this server.");
		}
		for (const id of new Set(userIds)) {
			if (!(await this.parties.isMember(partyId, id))) {
				throw new NotFound("Party member not found.");
			}
		}
	}

	/**
	 * STUN servers plus TURN credentials. With a TURN username configured the secret is that account's static password
	 * (hosted providers such as ExpressTURN); otherwise short-lived credentials are derived from the secret (coturn
	 * `use-auth-secret` scheme).
	 */
	async iceConfig(userId: string, now = Date.now()): Promise<IceConfig> {
		if (!(await this.isEnabled())) {
			throw new Forbidden("Calls are disabled on this server.");
		}
		const stun = await this.urls("calls_stun_urls");
		const turn = await this.urls("calls_turn_urls");
		const secret = await this.turnSecret();
		const iceServers: IceServer[] = [];
		if (stun.length > 0) {
			iceServers.push({ urls: stun });
		}
		const staticUsername = ((await this.setting("calls_turn_username")) as string | undefined)?.trim();
		const customSecret = ((await this.setting("calls_turn_secret")) as string | undefined)?.trim();
		if (turn.length > 0 && staticUsername && customSecret) {
			iceServers.push({ urls: turn, username: staticUsername, credential: customSecret });
		} else if (turn.length > 0 && secret) {
			const username = `${Math.floor(now / 1000) + CREDENTIAL_TTL_SECONDS}:${userId}`;
			iceServers.push({
				urls: turn,
				username,
				credential: createHmac("sha1", secret).update(username).digest("base64"),
			});
		}
		const relayOnly = (await this.setting("calls_relay_only")) === true && iceServers.some((server) => server.credential);
		return { iceServers, relayOnly };
	}

	private async turnSecret(): Promise<string | undefined> {
		const custom = await this.setting("calls_turn_secret");
		if (typeof custom === "string" && custom.trim() !== "") {
			return custom.trim();
		}
		const appSecret = appConfig().get("appSecret");
		return appSecret ? derivedTurnSecret(appSecret) : undefined;
	}

	private async urls(key: string): Promise<string[]> {
		const value = await this.setting(key);
		return Array.isArray(value) ? value.filter((url): url is string => typeof url === "string") : [];
	}

	private async setting(key: string): Promise<unknown> {
		const rows = (await this.dataSource.query(`SELECT value FROM settings WHERE key = $1`, [key])) as Array<{
			value: unknown;
		}>;
		return rows[0]?.value;
	}
}
