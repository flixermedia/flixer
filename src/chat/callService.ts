import { createHash, createHmac } from "node:crypto";
import { Inject, Injectable } from "@tsed/di";
import { Conflict, Forbidden, NotFound } from "@tsed/exceptions";
import { DataSource } from "typeorm";
import { appConfig } from "../config/store/appConfig.js";
import { PartiesService } from "../party/partiesService.js";
import { ChatMember } from "../entities/chat.entity.js";
import { ChatMlsDevice, ChatMlsKeyPackage } from "../entities/chatMls.entity.js";
import { Setting } from "../entities/setting.entity.js";
import { DefaultDataSource } from "../datasources/defaultDataSource.datasource.js";

const CREDENTIAL_TTL_SECONDS = 6 * 60 * 60;

export interface PartyKeyPackage {
	userId: string;
	deviceId: string;
	keyPackageId: string;
	keyPackage: string;
	available: boolean;
}

interface IceServer {
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
export interface QueuedCallSignal {
	type: "call-signal";
	conversationId: string;
	callId: string;
	from: string;
	payload: string;
	at: number;
	seq: number;
}

type SignalListener = (userIds: string[], signal: Omit<QueuedCallSignal, "at" | "seq">) => void;

@Injectable()
export class CallService {

	private readonly signalQueue = new Map<string, QueuedCallSignal[]>();
	private readonly signalListeners = new Set<SignalListener>();
	private nextSeq = 0;

	constructor(
		@Inject(DefaultDataSource) private readonly dataSource: DataSource,
		private readonly parties: PartiesService,
	) {}

	onSignal(listener: SignalListener): () => void {
		this.signalListeners.add(listener);
		return () => this.signalListeners.delete(listener);
	}

	enqueueSignal(targetUserIds: string[], signal: Omit<QueuedCallSignal, "at" | "seq">): void {
		const now = Date.now();
		const entry: QueuedCallSignal = { ...signal, at: now, seq: ++this.nextSeq };
		for (const uid of targetUserIds) {
			const list = (this.signalQueue.get(uid) ?? []).filter((item) => now - item.at < 60_000);
			list.push(entry);
			if (list.length > 100) list.splice(0, list.length - 100);
			this.signalQueue.set(uid, list);
		}
		for (const listener of this.signalListeners) {
			listener(targetUserIds, signal);
		}
	}

	/**
	 * Reads unexpired signals for a user after `after` without deleting them, so multiple open tabs for the same
	 * user do not steal call signals from each other.
	 */
	readSignals(userId: string, after = 0): { signals: Array<Omit<QueuedCallSignal, "at">>; cursor: number } {
		const list = this.signalQueue.get(userId);
		if (!list?.length) return { signals: [], cursor: after };
		const now = Date.now();
		const fresh = list.filter((item) => now - item.at < 60_000);
		if (fresh.length === 0) {
			this.signalQueue.delete(userId);
			return { signals: [], cursor: after };
		}
		if (fresh.length !== list.length) this.signalQueue.set(userId, fresh);
		const signals = fresh
			.filter((item) => item.seq > after)
			.map(({ type, conversationId, callId, from, payload, seq }) => ({ type, conversationId, callId, from, payload, seq }));
		const cursor = signals.length > 0 ? signals[signals.length - 1]!.seq : after;
		return { signals, cursor };
	}

	drainSignals(userId: string): Array<Omit<QueuedCallSignal, "at" | "seq">> {
		const list = this.signalQueue.get(userId);
		if (!list?.length) return [];
		this.signalQueue.delete(userId);
		const now = Date.now();
		return list
			.filter((item) => now - item.at < 60_000)
			.map(({ type, conversationId, callId, from, payload }) => ({ type, conversationId, callId, from, payload }));
	}

	async isEnabled(): Promise<boolean> {
		return (await this.setting("calls_enabled")) === true;
	}

	/** Returns the other members of a conversation the user belongs to; throws when calls are off or the user isn't a member. */
	async recipients(userId: string, conversationId: string): Promise<string[]> {
		if (!(await this.isEnabled())) {
			throw new Forbidden("Calls are disabled on this server.");
		}
		const rows = await this.dataSource.getRepository(ChatMember).find({ select: { userId: true }, where: { conversationId } });
		const ids = rows.map((row) => row.userId);
		if (!ids.includes(userId)) {
			throw new NotFound("Conversation not found.");
		}
		return ids.filter((id) => id !== userId);
	}

	/** Key packages of the caller's and one peer's active devices, for starting an encrypted voice link inside a party. */
	async partyKeyPackages(userId: string, partyId: string, peerId: string, lenient = false): Promise<PartyKeyPackage[]> {
		await this.assertPartyMembers(partyId, [userId, peerId]);
		const rows = await this.dataSource
			.getRepository(ChatMlsDevice)
			.createQueryBuilder("device")
			.innerJoin(ChatMlsKeyPackage, "keyPackage", "keyPackage.deviceId = device.id")
			.select("device.userId", "user_id")
			.addSelect("device.id", "device_id")
			.addSelect("keyPackage.id", "key_package_id")
			.addSelect("keyPackage.keyPackage", "key_package")
			.addSelect("keyPackage.usedAt IS NULL", "available")
			.where("device.status = 'active'")
			.andWhere("device.userId IN (:...userIds)", { userIds: [userId, peerId] })
			.orderBy("device.userId", "ASC")
			.addOrderBy("device.createdAt", "ASC")
			.addOrderBy("keyPackage.createdAt", "ASC")
			.getRawMany<{ user_id: string; device_id: string; key_package_id: string; key_package: string; available: boolean }>();
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
		const owner = await this.dataSource.getRepository(ChatMlsKeyPackage).createQueryBuilder("keyPackage").innerJoin(ChatMlsDevice, "device", "device.id = keyPackage.deviceId").select("device.userId", "user_id").addSelect("device.id", "device_id").addSelect("keyPackage.keyPackage", "key_package").where("keyPackage.id = :keyPackageId", { keyPackageId }).getRawOne<{ user_id: string; device_id: string; key_package: string }>();
		if (!owner) {
			throw new Conflict("That MLS key package was already used or is no longer available.");
		}
		await this.assertPartyMembers(partyId, [userId, owner.user_id]);
		const result = await this.dataSource
			.getRepository(ChatMlsKeyPackage)
			.createQueryBuilder()
			.update(ChatMlsKeyPackage)
			.set({ usedAt: () => "now()" })
			// RAW SQL: correlated active-device EXISTS predicate keeps the one-time claim atomic.
			.where('"id" = :keyPackageId AND "device_id" = :deviceId AND "used_at" IS NULL AND EXISTS (SELECT 1 FROM "chat_mls_devices" AS d WHERE d."id" = "chat_mls_key_packages"."device_id" AND d."status" = \'active\')', { keyPackageId, deviceId: owner.device_id })
			.execute();
		if (!result.affected) {
			throw new Conflict("That MLS key package was already used or is no longer available.");
		}
		return { userId: owner.user_id, deviceId: owner.device_id, keyPackageId, keyPackage: owner.key_package, available: false };
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
		return (await this.dataSource.getRepository(Setting).findOne({ where: { key } }))?.value;
	}
}
