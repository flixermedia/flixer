import { Inject, Injectable, logger } from "@tsed/di";
import { BadRequest, Conflict, Forbidden, NotFound, TooManyRequests } from "@tsed/exceptions";
import { createPublicKey, randomUUID, verify } from "node:crypto";
import { DataSource, EntityManager } from "typeorm";
import { DefaultDataSource } from "../datasources/defaultDataSource.datasource.js";
import { NotificationService } from "../api/notifications/notificationService.js";

export const MAX_MESSAGE_LENGTH = 2000;
export const MAX_ENCRYPTED_MESSAGE_LENGTH = 32768;
const MAX_MLS_PAYLOAD_LENGTH = 32768;
const MAX_MLS_HISTORY_BACKUP_LENGTH = 29_000_000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const MAX_GROUP_MEMBERS = 50;
export const MAX_GROUP_NAME = 60;
const PAGE_SIZE = 50;
const RATE_WINDOW_MS = 10_000;
const RATE_LIMIT = 10;
/** A member who fetched the thread this recently is looking at it, so a notification would be noise. */
const ACTIVE_MS = 15_000;

export interface ChatPerson {
	username: string;
	displayName: string;
	avatarUrl: string | null;
}

export interface ChatMember extends ChatPerson {
	role: "owner" | "member";
}

export interface ChatMessage {
	id: string;
	sequence: string;
	conversationId: string;
	kind: "text" | "system";
	encrypted: boolean;
	body: string;
	sender: ChatPerson | null;
	createdAt: string;
}

export interface ChatMlsDeviceSummary {
	deviceId: string;
	name: string;
	status: "active" | "pending" | "revoked";
	createdAt: string;
	approvedAt: string | null;
	approvalChallenge: string | null;
}

export interface ChatConversation {
	id: string;
	kind: "direct" | "group";
	encryptionMode: "encrypted" | "plaintext";
	name: string | null;
	supportChatOpen: boolean | null;
	members: ChatMember[];
	lastMessage: ChatMessage | null;
	unread: number;
	updatedAt: string;
}

/** The stable key that makes one direct conversation per pair of people. */
export function directKey(a: string, b: string): string {
	return [a, b].sort().join(":");
}

/** Trims a message and rejects empty or oversized ones. */
export function cleanMessage(text: unknown): string {

	const body = typeof text === "string" ? text.replace(/\r\n/g, "\n").trim() : "";
	if (body.length === 0) {
		throw new BadRequest("Write a message first.");
	}
	if (body.length > MAX_MESSAGE_LENGTH) {
		throw new BadRequest(`Messages can be up to ${MAX_MESSAGE_LENGTH} characters.`);
	}
	return body;

}

function cleanEncryptedMessage(value: unknown): string {
	if (
		typeof value !== "string" ||
		value.length === 0 ||
		value.length > MAX_ENCRYPTED_MESSAGE_LENGTH ||
		!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
	) {
		throw new BadRequest(`Encrypted messages must be valid base64 up to ${MAX_ENCRYPTED_MESSAGE_LENGTH} characters.`);
	}
	return value;
}

function cleanMlsPayload(value: unknown, label: string): string {
	if (
		typeof value !== "string" ||
		value.length === 0 ||
		value.length > MAX_MLS_PAYLOAD_LENGTH ||
		!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
	) {
		throw new BadRequest(`${label} must be valid base64 up to ${MAX_MLS_PAYLOAD_LENGTH} characters.`);
	}
	return value;
}

export function cleanName(text: unknown): string {

	const name = typeof text === "string" ? text.trim().replace(/\s+/g, " ") : "";
	if (name.length === 0 || name.length > MAX_GROUP_NAME) {
		throw new BadRequest(`Group names are 1 to ${MAX_GROUP_NAME} characters.`);
	}
	return name;

}

const avatarUrl = (file: string | null) => (file ? `/auth/avatars/${file}` : null);

interface PersonRow {
	id: string;
	username: string;
	display_name: string | null;
	avatar_file: string | null;
}

const personOf = (row: PersonRow): ChatPerson => ({
	username: row.username,
	displayName: row.display_name || row.username,
	avatarUrl: avatarUrl(row.avatar_file),
});

interface MessageRow {
	id: string;
	sequence: string | number;
	conversation_id: string;
	kind: "text" | "system";
	encrypted: boolean;
	body: string;
	created_at: Date;
	username: string | null;
	display_name: string | null;
	avatar_file: string | null;
}

const messageOf = (row: MessageRow): ChatMessage => ({
	id: row.id,
	sequence: String(row.sequence),
	conversationId: row.conversation_id,
	kind: row.kind,
	encrypted: row.encrypted,
	body: row.body,
	sender: row.username ? personOf({ id: "", username: row.username, display_name: row.display_name, avatar_file: row.avatar_file }) : null,
	createdAt: row.created_at.toISOString(),
});

const MESSAGE_SELECT = `SELECT m.id, m.sequence, m.conversation_id, m.kind, m.encrypted, m.body, m.created_at, u.username, u.display_name, up.avatar_file
	FROM chat_messages m LEFT JOIN users u ON u.id = m.user_id LEFT JOIN user_preferences up ON up.user_id = u.id`;

/** Direct messages and group chats between the people on this server. */
export type ChatEvent = { type: "message"; conversationId: string; message: ChatMessage } | { type: "changed"; conversationId: string };

@Injectable()
export class ChatService {

	private readonly recentSends = new Map<string, number[]>();
	private readonly listeners = new Set<(userIds: string[], event: ChatEvent) => void>();

	constructor(
		@Inject(DefaultDataSource) private readonly dataSource: DataSource,
		private readonly notifications: NotificationService,
	) {}

	/** Subscribes to realtime events; returns an unsubscribe function. */
	onEvent(listener: (userIds: string[], event: ChatEvent) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private publish(userIds: string[], event: ChatEvent): void {
		if (userIds.length === 0) {
			return;
		}
		for (const listener of this.listeners) {
			try {
				listener(userIds, event);
			} catch (error) {
				logger().warn("Chat listener failed.", error);
			}
		}
	}

	private async memberIds(id: string): Promise<string[]> {
		const rows = (await this.dataSource.query(`SELECT user_id FROM chat_members WHERE conversation_id = $1`, [id])) as Array<{ user_id: string }>;
		return rows.map((row) => row.user_id);
	}

	/** Tells members (plus anyone just removed) to refresh a conversation. */
	private async changed(id: string, extra: string[] = []): Promise<void> {
		const ids = new Set([...(await this.memberIds(id)), ...extra]);
		this.publish([...ids], { type: "changed", conversationId: id });
	}

	private async defaultEncryptionMode(manager: EntityManager): Promise<"encrypted" | "plaintext"> {
		const rows = (await manager.query(`SELECT value FROM settings WHERE key = $1 FOR SHARE`, ["chat_e2ee_enabled"])) as Array<{
			value: unknown;
		}>;
		if (!rows[0] || typeof rows[0].value !== "boolean") {
			throw new Error("The chat_e2ee_enabled setting is missing or invalid.");
		}
		return rows[0].value ? "encrypted" : "plaintext";
	}

	async supportChatChanged(id: string): Promise<void> {
		await this.changed(id);
	}

	async downgradeToPlaintext(userId: string, id: string): Promise<ChatConversation> {
		const changed = await this.setEncryptionMode(userId, id, "plaintext");
		if (changed) await this.changed(id);
		return this.conversation(userId, id);
	}

	async upgradeToEncrypted(userId: string, id: string): Promise<ChatConversation> {
		const changed = await this.setEncryptionMode(userId, id, "encrypted");
		if (changed) await this.changed(id);
		return this.conversation(userId, id);
	}

	private async setEncryptionMode(
		userId: string,
		id: string,
		encryptionMode: "encrypted" | "plaintext",
	): Promise<boolean> {
		return this.dataSource.transaction(async (manager) => {
			const rows = (await manager.query(
				`SELECT c.encryption_mode${encryptionMode === "plaintext" ? ", s.value AS downgrade_enabled" : ""}
				FROM chat_conversations c
				JOIN chat_members m ON m.conversation_id = c.id AND m.user_id = $2
				${encryptionMode === "plaintext" ? "JOIN settings s ON s.key = 'chat_user_downgrade_enabled'" : ""}
				WHERE c.id = $1
				FOR UPDATE OF c, m${encryptionMode === "plaintext" ? "\n\t\t\t\tFOR SHARE OF s" : ""}`,
				[id, userId],
			)) as Array<{ encryption_mode: "encrypted" | "plaintext"; downgrade_enabled?: unknown }>;
			const conversation = rows[0];
			if (!conversation) throw new NotFound("Conversation not found.");
			if (encryptionMode === "plaintext" && conversation.downgrade_enabled !== true) {
				throw new Forbidden("Your server administrator has not enabled plaintext chat switching.");
			}
			if (conversation.encryption_mode === encryptionMode) return false;
			await manager.query(`UPDATE chat_conversations SET encryption_mode = $2 WHERE id = $1`, [id, encryptionMode]);
			const notice = encryptionMode === "plaintext"
				? "Switched this conversation to plaintext. Future messages are readable by the server."
				: "Switched this conversation to end-to-end encryption. Earlier plaintext messages remain readable by the server.";
			await manager.query(
				`INSERT INTO chat_messages (id, conversation_id, user_id, kind, body, encrypted)
				VALUES ($1, $2, $3, 'system', $4, false)`,
				[randomUUID(), id, userId, notice],
			);
			await manager.query(`UPDATE chat_conversations SET last_message_at = now() WHERE id = $1`, [id]);
			return true;
		});
	}

	async conversations(userId: string): Promise<{ conversations: ChatConversation[]; unread: number }> {
		const ids = (await this.dataSource.query(
			`SELECT c.id FROM chat_conversations c JOIN chat_members m ON m.conversation_id = c.id
			WHERE m.user_id = $1 ORDER BY c.last_message_at DESC LIMIT 200`,
			[userId],
		)) as Array<{ id: string }>;
		const conversations = await this.summaries(
			userId,
			ids.map((row) => row.id),
		);
		return { conversations, unread: conversations.reduce((total, item) => total + item.unread, 0) };
	}

	async conversation(userId: string, id: string): Promise<ChatConversation> {
		await this.assertMember(userId, id);
		return (await this.summaries(userId, [id]))[0];
	}

	async registerMlsDevice(
		userId: string,
		deviceId: string,
		name: unknown,
		keyPackage: unknown,
		pairingPublicKey: unknown,
	): Promise<{ deviceId: string; keyPackageId: string; status: "active" | "pending"; approvalChallenge: string | null }> {
		const label = typeof name === "string" ? name.trim().replace(/\s+/g, " ") : "";
		if (!label || label.length > 80) throw new BadRequest("Device names are 1 to 80 characters.");
		const serializedKeyPackage = cleanMlsPayload(keyPackage, "The MLS key package");
		if (typeof pairingPublicKey !== "string" || pairingPublicKey.length > 512 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(pairingPublicKey)) {
			throw new BadRequest("The device pairing key is invalid.");
		}
		try {
			createPublicKey({ key: Buffer.from(pairingPublicKey, "base64"), format: "der", type: "spki" });
		} catch {
			throw new BadRequest("The device pairing key is invalid.");
		}

		return this.dataSource.transaction(async (manager) => {
			await manager.query(`SELECT id FROM users WHERE id = $1 FOR UPDATE`, [userId]);
			const existing = (await manager.query(
				`SELECT user_id, status, pairing_public_key, approval_challenge FROM chat_mls_devices WHERE id = $1 FOR UPDATE`,
				[deviceId],
			)) as Array<{ user_id: string; status: string; pairing_public_key: string; approval_challenge: string | null }>;
			if (existing[0] && existing[0].user_id !== userId) {
				throw new Conflict("That chat device is already registered to another account.");
			}
			if (existing[0]?.status === "revoked") {
				throw new Conflict("That chat device has been revoked.");
			}
			if (existing[0]?.pairing_public_key && existing[0].pairing_public_key !== pairingPublicKey) {
				throw new Conflict("That chat device is already registered with a different pairing key.");
			}

			const status = "active";
			if (existing[0]) {
				await manager.query(
					`UPDATE chat_mls_devices SET name = $2, status = 'active', approval_challenge = NULL, approved_at = COALESCE(approved_at, now()), pairing_public_key = COALESCE(pairing_public_key, $3) WHERE id = $1`,
					[deviceId, label, pairingPublicKey],
				);
			} else {
				const approvalChallenge = null;
				await manager.query(
					`INSERT INTO chat_mls_devices (id, user_id, name, status, pairing_public_key, approval_challenge, approved_at)
					VALUES ($1, $2, $3, $4, $5, $6, CASE WHEN $7::boolean THEN now() ELSE NULL END)`,
					[deviceId, userId, label, status, pairingPublicKey, approvalChallenge, status === "active"],
				);
			}
			const existingPackage = (await manager.query(
				`SELECT id FROM chat_mls_key_packages WHERE device_id = $1 AND key_package = $2 ORDER BY created_at DESC LIMIT 1`,
				[deviceId, serializedKeyPackage],
			)) as Array<{ id: string }>;
			const keyPackageId = existingPackage[0]?.id ?? randomUUID();
			if (!existingPackage[0]) {
				await manager.query(
					`INSERT INTO chat_mls_key_packages (id, device_id, key_package) VALUES ($1, $2, $3)`,
					[keyPackageId, deviceId, serializedKeyPackage],
				);
			}
			return { deviceId, keyPackageId, status, approvalChallenge: null };
		});
	}

	async listMlsDevices(userId: string): Promise<ChatMlsDeviceSummary[]> {
		const rows = (await this.dataSource.query(
			`SELECT id, name, status, created_at, approved_at, approval_challenge
			FROM chat_mls_devices WHERE user_id = $1 ORDER BY created_at`,
			[userId],
		)) as Array<{ id: string; name: string; status: ChatMlsDeviceSummary["status"]; created_at: Date; approved_at: Date | null; approval_challenge: string | null }>;
		return rows.map((row) => ({
			deviceId: row.id,
			name: row.name,
			status: row.status,
			createdAt: row.created_at.toISOString(),
			approvedAt: row.approved_at?.toISOString() ?? null,
			approvalChallenge: row.approval_challenge,
		}));
	}

	async chatHistoryBackup(userId: string): Promise<string | null> {
		const rows = (await this.dataSource.query(
			`SELECT backup FROM chat_mls_history_backups WHERE user_id = $1`,
			[userId],
		)) as Array<{ backup: string }>;
		return rows[0]?.backup ?? null;
	}

	async saveChatHistoryBackup(userId: string, backup: unknown): Promise<void> {
		if (typeof backup !== "string" || backup.length === 0 || backup.length > MAX_MLS_HISTORY_BACKUP_LENGTH) {
			throw new BadRequest("The encrypted chat history backup is invalid or too large.");
		}
		await this.dataSource.query(
			`INSERT INTO chat_mls_history_backups (user_id, backup)
			VALUES ($1, $2)
			ON CONFLICT (user_id) DO UPDATE SET backup = EXCLUDED.backup, updated_at = now()`,
			[userId, backup],
		);
	}

	async revokeMlsDevice(userId: string, deviceId: string): Promise<void> {
		await this.dataSource.transaction(async (manager) => {
			const rows = (await manager.query(
				`UPDATE chat_mls_devices SET status = 'revoked', revoked_at = now()
				WHERE id = $1 AND user_id = $2 AND status <> 'revoked'
				RETURNING id`,
				[deviceId, userId],
			)) as Array<{ id: string }>;
			if (!rows.length) {
				const existing = (await manager.query(
					`SELECT id FROM chat_mls_devices WHERE id = $1 AND user_id = $2`,
					[deviceId, userId],
				)) as Array<{ id: string }>;
				if (!existing.length) throw new NotFound("Chat device not found.");
				return;
			}
			await manager.query(
				`UPDATE chat_mls_key_packages SET used_at = COALESCE(used_at, now()) WHERE device_id = $1`,
				[deviceId],
			);
		});
	}

	async approveMlsDevice(userId: string, approverDeviceId: string, targetDeviceId: string, signature: unknown): Promise<void> {
		if (typeof signature !== "string" || signature.length > 256 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(signature)) {
			throw new BadRequest("The device approval signature is invalid.");
		}
		await this.dataSource.transaction(async (manager) => {
			const rows = (await manager.query(
				`SELECT target.approval_challenge, approver.pairing_public_key
				FROM chat_mls_devices target
				JOIN chat_mls_devices approver ON approver.user_id = target.user_id
				WHERE target.id = $1 AND target.user_id = $2 AND target.status = 'pending'
				AND approver.id = $3 AND approver.status = 'active'
				FOR UPDATE OF target`,
				[targetDeviceId, userId, approverDeviceId],
			)) as Array<{ approval_challenge: string | null; pairing_public_key: string }>;
			const target = rows[0];
			if (!target?.approval_challenge) throw new NotFound("That pending chat device was not found.");
			const payload = Buffer.from(`flixer-chat-device-approval:v1:${targetDeviceId}:${target.approval_challenge}`);
			let valid = false;
			try {
				valid = verify(
					"sha256",
					payload,
					{ key: Buffer.from(target.pairing_public_key, "base64"), format: "der", type: "spki", dsaEncoding: "ieee-p1363" },
					Buffer.from(signature, "base64"),
				);
			} catch {
				throw new BadRequest("The device approval signature could not be verified.");
			}
			if (!valid) throw new Forbidden("Approval must be signed by a trusted device on this account.");
			await manager.query(
				`UPDATE chat_mls_devices SET status = 'active', approved_at = now(), approval_challenge = NULL WHERE id = $1`,
				[targetDeviceId],
			);
		});
	}

	async addMlsKeyPackage(userId: string, deviceId: string, keyPackage: unknown): Promise<{ keyPackageId: string }> {
		const serializedKeyPackage = cleanMlsPayload(keyPackage, "The MLS key package");
		const device = (await this.dataSource.query(
			`SELECT id FROM chat_mls_devices WHERE id = $1 AND user_id = $2 AND status = 'active'`,
			[deviceId, userId],
		)) as Array<{ id: string }>;
		if (!device[0]) throw new NotFound("Active chat device not found.");
		const duplicate = (await this.dataSource.query(
			`SELECT id FROM chat_mls_key_packages WHERE device_id = $1 AND key_package = $2 ORDER BY created_at DESC LIMIT 1`,
			[deviceId, serializedKeyPackage],
		)) as Array<{ id: string }>;
		if (duplicate[0]) return { keyPackageId: duplicate[0].id };
		const keyPackageId = randomUUID();
		await this.dataSource.query(
			`INSERT INTO chat_mls_key_packages (id, device_id, key_package) VALUES ($1, $2, $3)`,
			[keyPackageId, deviceId, serializedKeyPackage],
		);
		return { keyPackageId };
	}

	async deviceMlsKeyPackages(
		userId: string,
		deviceId: string,
	): Promise<Array<{ keyPackageId: string; keyPackage: string; available: boolean }>> {
		const rows = (await this.dataSource.query(
			`SELECT k.id, k.key_package, (k.used_at IS NULL) AS available
			FROM chat_mls_devices d JOIN chat_mls_key_packages k ON k.device_id = d.id
			WHERE d.id = $1 AND d.user_id = $2 AND d.status = 'active'
			ORDER BY k.created_at`,
			[deviceId, userId],
		)) as Array<{ id: string; key_package: string; available: boolean }>;
		if (!rows.length) {
			const device = (await this.dataSource.query(
				`SELECT id FROM chat_mls_devices WHERE id = $1 AND user_id = $2 AND status = 'active'`,
				[deviceId, userId],
			)) as Array<{ id: string }>;
			if (!device[0]) throw new NotFound("Active chat device not found.");
		}
		return rows.map((row) => ({ keyPackageId: row.id, keyPackage: row.key_package, available: row.available }));
	}

	async conversationMlsKeyPackages(
		userId: string,
		conversationId: string,
		lenient = false,
	): Promise<Array<{ userId: string; deviceId: string; keyPackageId: string; keyPackage: string; available: boolean }>> {
		const member = await this.assertMember(userId, conversationId);
		if (member.kind === "group") {
			const support = (await this.dataSource.query(
				`SELECT user_id FROM issue_reports WHERE conversation_id = $1`,
				[conversationId],
			)) as Array<{ user_id: string }>;
			if (support[0]) await this.ensureSupportRequester(conversationId, support[0].user_id);
		}
		// Joiners only need the identity directory, so they skip the "everyone has a spare key package" check.
		const unready = lenient ? [] : (await this.dataSource.query(
			`SELECT m.user_id
			FROM chat_members m
			LEFT JOIN chat_mls_devices d ON d.user_id = m.user_id AND d.status = 'active'
			LEFT JOIN chat_mls_key_packages k ON k.device_id = d.id AND k.used_at IS NULL
			WHERE m.conversation_id = $1
			GROUP BY m.user_id
			HAVING count(DISTINCT d.id) = 0
				OR count(DISTINCT d.id) FILTER (WHERE k.id IS NOT NULL) < count(DISTINCT d.id)`,
			[conversationId],
		)) as Array<{ user_id: string }>;
		if (unready.length > 0) {
			throw new Conflict("Every active chat device needs an unused MLS key package. Ask each member to open Flixer and try again.");
		}
		return (await this.dataSource.query(
			`SELECT d.user_id, d.id AS device_id, k.id AS key_package_id, k.key_package, (k.used_at IS NULL) AS available
			FROM chat_members m
			JOIN chat_mls_devices d ON d.user_id = m.user_id AND d.status = 'active'
			JOIN chat_mls_key_packages k ON k.device_id = d.id
			WHERE m.conversation_id = $1
			ORDER BY d.user_id, d.created_at, k.created_at`,
			[conversationId],
		) as Array<{ user_id: string; device_id: string; key_package_id: string; key_package: string; available: boolean }>).map((row) => ({
			userId: row.user_id,
			deviceId: row.device_id,
			keyPackageId: row.key_package_id,
			keyPackage: row.key_package,
			available: row.available,
		}));
	}

	async claimMlsKeyPackage(userId: string, conversationId: string, keyPackageId: string): Promise<{
		userId: string;
		deviceId: string;
		keyPackageId: string;
		keyPackage: string;
		available: false;
	}> {
		await this.assertMember(userId, conversationId);
		return this.dataSource.transaction(async (manager) => {
			const rows = (await manager.query(
				`UPDATE chat_mls_key_packages k SET used_at = now()
				FROM chat_mls_devices d, chat_members m
				WHERE k.id = $1 AND k.device_id = d.id AND d.status = 'active'
				AND m.conversation_id = $2 AND m.user_id = d.user_id
				AND k.used_at IS NULL
				RETURNING d.user_id, d.id AS device_id, k.id AS key_package_id, k.key_package`,
				[keyPackageId, conversationId],
			)) as Array<{ user_id: string; device_id: string; key_package_id: string; key_package: string }>;
			const row = rows[0];
			if (!row) throw new Conflict("That MLS key package was already used or is no longer available.");
			return { userId: row.user_id, deviceId: row.device_id, keyPackageId: row.key_package_id, keyPackage: row.key_package, available: false };
		});
	}

	async storeMlsWelcome(
		userId: string,
		conversationId: string,
		messageId: string,
		recipients: Array<{ deviceId: string; keyPackageId: string }>,
		welcome: unknown,
		ratchetTree: unknown,
	): Promise<void> {
		await this.assertMember(userId, conversationId);
		await this.dataSource.transaction((manager) =>
			this.storeMlsWelcomeRows(manager, userId, conversationId, messageId, recipients, welcome, ratchetTree),
		);
	}

	private async storeMlsWelcomeRows(
		manager: { query: (sql: string, parameters?: unknown[]) => Promise<unknown[]> },
		userId: string,
		conversationId: string,
		messageId: string,
		recipients: Array<{ deviceId: string; keyPackageId: string }>,
		welcome: unknown,
		ratchetTree: unknown,
	): Promise<void> {
		const serializedWelcome = cleanMlsPayload(welcome, "The MLS Welcome message");
		const serializedTree = cleanMlsPayload(ratchetTree, "The MLS ratchet tree");
		if (!UUID_PATTERN.test(messageId) || !Array.isArray(recipients) || recipients.length === 0 || recipients.length > 200) {
			throw new BadRequest("The MLS Welcome recipients or message ID are invalid.");
		}
		const uniqueRecipients = new Map(recipients.map(({ deviceId, keyPackageId }) => [`${deviceId}:${keyPackageId}`, { deviceId, keyPackageId }]));
		if (uniqueRecipients.size !== recipients.length || recipients.some(({ deviceId, keyPackageId }) => !UUID_PATTERN.test(deviceId) || !UUID_PATTERN.test(keyPackageId))) {
			throw new BadRequest("The MLS Welcome recipients are invalid.");
		}
		const message = (await manager.query(
			`SELECT id FROM chat_messages WHERE id = $1 AND conversation_id = $2 AND user_id = $3 AND kind = 'text'`,
			[messageId, conversationId, userId],
		)) as Array<{ id: string }>;
		if (!message[0]) throw new NotFound("The encrypted chat message was not found.");
		const packageIds = recipients.map(({ keyPackageId }) => keyPackageId);
		const deviceIds = recipients.map(({ deviceId }) => deviceId);
		const welcomeIds = recipients.map(() => randomUUID());
		const valid = (await manager.query(
			`SELECT d.id AS device_id, k.id AS key_package_id
				FROM unnest($1::uuid[], $2::uuid[]) AS r(device_id, key_package_id)
				JOIN chat_mls_devices d ON d.id = r.device_id AND d.status = 'active'
				JOIN chat_mls_key_packages k ON k.id = r.key_package_id AND k.device_id = d.id AND k.used_at IS NOT NULL
				JOIN chat_members m ON m.user_id = d.user_id AND m.conversation_id = $3`,
			[deviceIds, packageIds, conversationId],
		)) as Array<{ device_id: string; key_package_id: string }>;
		if (valid.length !== recipients.length) {
			throw new BadRequest("Every MLS Welcome recipient must be an active device with a claimed key package in this conversation.");
		}
		await manager.query(
			`INSERT INTO chat_mls_welcomes (id, conversation_id, device_id, key_package_id, message_id, welcome, ratchet_tree)
				SELECT r.id, $1, r.device_id, r.key_package_id, $2, $6, $7
				FROM unnest($3::uuid[], $4::uuid[], $5::uuid[]) AS r(device_id, key_package_id, id)
				ON CONFLICT (conversation_id, key_package_id) DO NOTHING`,
			[conversationId, messageId, deviceIds, packageIds, welcomeIds, serializedWelcome, serializedTree],
		);
		const rows = (await manager.query(
			`SELECT message_id, welcome, ratchet_tree FROM chat_mls_welcomes
				WHERE conversation_id = $1 AND key_package_id = ANY($2::uuid[])`,
			[conversationId, packageIds],
		)) as Array<{ message_id: string; welcome: string; ratchet_tree: string }>;
		if (
			rows.length !== recipients.length ||
			rows.some((row) => row.message_id !== messageId || row.welcome !== serializedWelcome || row.ratchet_tree !== serializedTree)
		) {
			throw new Conflict("A different MLS Welcome is already stored for one of these key packages.");
		}
	}

	async pendingMlsWelcomes(
		userId: string,
		conversationId: string,
		deviceId: string,
	): Promise<Array<{ id: string; messageId: string; keyPackageId: string; welcome: string; ratchetTree: string; createdAt: string }>> {
		await this.assertMember(userId, conversationId);
		const device = (await this.dataSource.query(
			`SELECT id FROM chat_mls_devices WHERE id = $1 AND user_id = $2 AND status = 'active'`,
			[deviceId, userId],
		)) as Array<{ id: string }>;
		if (!device[0]) throw new NotFound("Chat device not found.");
		const rows = (await this.dataSource.query(
			`SELECT id, message_id, key_package_id, welcome, ratchet_tree, created_at FROM chat_mls_welcomes
			WHERE conversation_id = $1 AND device_id = $2 AND consumed_at IS NULL AND message_id IS NOT NULL
			ORDER BY created_at ASC`,
			[conversationId, deviceId],
		)) as Array<{ id: string; message_id: string; key_package_id: string; welcome: string; ratchet_tree: string; created_at: Date }>;
		return rows.map((row) => ({
			id: row.id,
			messageId: row.message_id,
			keyPackageId: row.key_package_id,
			welcome: row.welcome,
			ratchetTree: row.ratchet_tree,
			createdAt: row.created_at.toISOString(),
		}));
	}

	async acknowledgeMlsWelcome(userId: string, conversationId: string, deviceId: string, welcomeId: string): Promise<void> {
		await this.assertMember(userId, conversationId);
		const rows = (await this.dataSource.query(
			`UPDATE chat_mls_welcomes w SET consumed_at = now()
			FROM chat_mls_devices d
			WHERE w.id = $1 AND w.conversation_id = $2 AND w.device_id = $3
			AND d.id = w.device_id AND d.user_id = $4 AND d.status = 'active'
			RETURNING w.id`,
			[welcomeId, conversationId, deviceId, userId],
		)) as Array<{ id: string }>;
		if (!rows[0]) throw new NotFound("MLS Welcome message not found.");
	}

	async startDirect(userId: string, username: string): Promise<ChatConversation> {
		const [other] = await this.resolve([username], userId);
		if (other.id === userId) {
			throw new BadRequest("You can't message yourself.");
		}
		const key = directKey(userId, other.id);
		const existing = (await this.dataSource.query(`SELECT id FROM chat_conversations WHERE direct_key = $1`, [key])) as Array<{ id: string }>;
		if (existing[0]) {
			return this.conversation(userId, existing[0].id);
		}
		const id = randomUUID();
		await this.dataSource.transaction(async (manager) => {
			const encryptionMode = await this.defaultEncryptionMode(manager);
			await manager.query(
				`INSERT INTO chat_conversations (id, kind, direct_key, created_by, encryption_mode)
				VALUES ($1, 'direct', $2, $3, $4)`,
				[id, key, userId, encryptionMode],
			);
			await manager.query(`INSERT INTO chat_members (conversation_id, user_id, role) VALUES ($1, $2, 'member'), ($1, $3, 'member')`, [id, userId, other.id]);
		});
		await this.changed(id);
		return this.conversation(userId, id);
	}

	async createGroup(userId: string, name: unknown, usernames: string[]): Promise<ChatConversation> {
		const title = cleanName(name);
		const others = (await this.resolve(usernames, userId)).filter((person) => person.id !== userId);
		if (others.length === 0) {
			throw new BadRequest("Pick at least one other person.");
		}
		if (others.length + 1 > MAX_GROUP_MEMBERS) {
			throw new BadRequest(`Groups can have up to ${MAX_GROUP_MEMBERS} people.`);
		}
		const id = randomUUID();
		await this.dataSource.transaction(async (manager) => {
			const encryptionMode = await this.defaultEncryptionMode(manager);
			await manager.query(
				`INSERT INTO chat_conversations (id, kind, name, created_by, encryption_mode)
				VALUES ($1, 'group', $2, $3, $4)`,
				[id, title, userId, encryptionMode],
			);
			await manager.query(`INSERT INTO chat_members (conversation_id, user_id, role) VALUES ($1, $2, 'owner')`, [id, userId]);
			for (const person of others) {
				await manager.query(`INSERT INTO chat_members (conversation_id, user_id, role) VALUES ($1, $2, 'member')`, [id, person.id]);
			}
		});
		await this.system(id, userId, `created the group "${title}"`);
		await this.changed(id);
		return this.conversation(userId, id);
	}

	/** Creates a support chat with members selected by the ticket system rather than public-profile lookup. */
	async createSupportGroup(adminId: string, requesterId: string, name: string): Promise<ChatConversation> {
		const title = cleanName(name);
		const id = randomUUID();
		await this.dataSource.transaction(async (manager) => {
			const encryptionMode = await this.defaultEncryptionMode(manager);
			await manager.query(
				`INSERT INTO chat_conversations (id, kind, name, created_by, encryption_mode)
				VALUES ($1, 'group', $2, $3, $4)`,
				[id, title, adminId, encryptionMode],
			);
			await manager.query(`INSERT INTO chat_members (conversation_id, user_id, role) VALUES ($1, $2, 'owner')`, [id, adminId]);
			if (requesterId !== adminId) {
				await manager.query(`INSERT INTO chat_members (conversation_id, user_id, role) VALUES ($1, $2, 'member')`, [id, requesterId]);
			}
		});
		await this.system(id, adminId, "opened a support chat for this issue");
		await this.changed(id);
		return this.conversation(adminId, id);
	}

	/** Re-adds the issue requester without changing the existing conversation or its message history. */
	async ensureSupportRequester(conversationId: string, requesterId: string): Promise<void> {
		const rows = (await this.dataSource.query(
			`INSERT INTO chat_members (conversation_id, user_id, role, last_read_at)
			SELECT c.id, $2, CASE WHEN c.created_by = $2 THEN 'owner' ELSE 'member' END,
				COALESCE((SELECT max(created_at) FROM chat_messages WHERE conversation_id = c.id), now())
			FROM chat_conversations c WHERE c.id = $1
			ON CONFLICT DO NOTHING RETURNING user_id`,
			[conversationId, requesterId],
		)) as Array<{ user_id: string }>;
		if (rows.length === 0) return;
		await this.system(conversationId, null, "rejoined the issue support chat");
		await this.changed(conversationId, [requesterId]);
	}

	async rename(userId: string, id: string, name: unknown): Promise<ChatConversation> {
		const member = await this.assertMember(userId, id);
		if (member.kind !== "group") {
			throw new BadRequest("Only groups can be renamed.");
		}
		const title = cleanName(name);
		await this.dataSource.query(`UPDATE chat_conversations SET name = $2 WHERE id = $1`, [id, title]);
		await this.system(id, userId, `renamed the group to "${title}"`);
		await this.changed(id);
		return this.conversation(userId, id);
	}

	async addMembers(userId: string, id: string, usernames: string[]): Promise<ChatConversation> {
		const member = await this.assertMember(userId, id);
		if (member.kind !== "group") {
			throw new BadRequest("People can only be added to groups.");
		}
		const people = await this.resolve(usernames, userId);
		const current = (await this.dataSource.query(`SELECT user_id FROM chat_members WHERE conversation_id = $1`, [id])) as Array<{ user_id: string }>;
		const have = new Set(current.map((row) => row.user_id));
		const fresh = people.filter((person) => !have.has(person.id));
		if (have.size + fresh.length > MAX_GROUP_MEMBERS) {
			throw new BadRequest(`Groups can have up to ${MAX_GROUP_MEMBERS} people.`);
		}
		for (const person of fresh) {
			await this.dataSource.query(`INSERT INTO chat_members (conversation_id, user_id, role) VALUES ($1, $2, 'member') ON CONFLICT DO NOTHING`, [id, person.id]);
			await this.system(id, userId, `added ${person.display_name || person.username}`);
		}
		if (fresh.length > 0) {
			await this.changed(id);
		}
		return this.conversation(userId, id);
	}

	/** Leaves a group, or removes someone else when the caller owns it. */
	async removeMember(userId: string, id: string, username: string): Promise<void> {
		const member = await this.assertMember(userId, id);
		if (member.kind !== "group") {
			throw new BadRequest("You can't leave a direct conversation.");
		}
		const target = (await this.dataSource.query(
			`SELECT u.id, u.username, u.display_name, m.role FROM chat_members m JOIN users u ON u.id = m.user_id
			WHERE m.conversation_id = $1 AND lower(u.username) = lower($2)`,
			[id, username],
		)) as Array<{ id: string; username: string; display_name: string | null; role: string }>;
		if (!target[0]) {
			throw new NotFound("That person isn't in this group.");
		}
		const leaving = target[0].id === userId;
		if (!leaving && member.role !== "owner") {
			throw new Forbidden("Only the group owner can remove people.");
		}
		const before = await this.memberIds(id);
		await this.dataSource.query(`DELETE FROM chat_members WHERE conversation_id = $1 AND user_id = $2`, [id, target[0].id]);
		const remaining = (await this.dataSource.query(`SELECT user_id, role FROM chat_members WHERE conversation_id = $1 ORDER BY joined_at ASC`, [id])) as Array<{ user_id: string; role: string }>;
		if (remaining.length === 0) {
			await this.dataSource.query(`UPDATE issue_reports SET conversation_id = NULL, chat_open = false, updated_at = now() WHERE conversation_id = $1`, [id]);
			await this.dataSource.query(`DELETE FROM chat_conversations WHERE id = $1`, [id]);
			this.publish(before, { type: "changed", conversationId: id });
			return;
		}
		if (!remaining.some((row) => row.role === "owner")) {
			await this.dataSource.query(`UPDATE chat_members SET role = 'owner' WHERE conversation_id = $1 AND user_id = $2`, [id, remaining[0].user_id]);
		}
		const name = target[0].display_name || target[0].username;
		await this.system(id, null, leaving ? `${name} left` : `${name} was removed`);
		await this.changed(id, before);
	}

	/** Messages oldest first. `before` pages back through history, `after` fetches what arrived since. Fetching marks the thread read. */
	async messages(
		userId: string,
		id: string,
		options: { before?: string; after?: string; beforeSequence?: string; afterSequence?: string },
	): Promise<{ messages: ChatMessage[]; hasMore: boolean }> {
		await this.assertMember(userId, id);
		const before = this.date(options.before);
		const after = this.date(options.after);
		const beforeSequence = this.sequence(options.beforeSequence);
		const afterSequence = this.sequence(options.afterSequence);
		const params: unknown[] = [id];
		let where = "m.conversation_id = $1";
		if (beforeSequence) {
			params.push(beforeSequence);
			where += ` AND m.sequence < $${params.length}::bigint`;
		} else if (before) {
			params.push(before);
			where += ` AND m.created_at < $${params.length}`;
		}
		if (afterSequence) {
			params.push(afterSequence);
			where += ` AND m.sequence > $${params.length}::bigint`;
		} else if (after) {
			params.push(after);
			where += ` AND m.created_at > $${params.length}`;
		}
		const rows = (await this.dataSource.query(
			`${MESSAGE_SELECT} WHERE ${where} ORDER BY m.sequence ${after || afterSequence ? "ASC" : "DESC"} LIMIT ${PAGE_SIZE + 1}`,
			params,
		)) as MessageRow[];
		const hasMore = rows.length > PAGE_SIZE;
		const page = rows.slice(0, PAGE_SIZE).map(messageOf);
		await this.markRead(userId, id, false);
		return { messages: after || afterSequence ? page : page.reverse(), hasMore: after || afterSequence ? false : hasMore };
	}

	/** Deletes a conversation for everyone: any direct-chat member, a group owner, or a support-chat member. */
	async deleteConversation(userId: string, id: string): Promise<void> {
		const member = await this.assertMember(userId, id);
		const supportThread = (await this.dataSource.query(`SELECT id FROM issue_reports WHERE conversation_id = $1`, [id])) as Array<{ id: string }>;
		if (member.kind === "group" && member.role !== "owner" && supportThread.length === 0) {
			throw new Forbidden("Only the group owner can delete it.");
		}
		const members = await this.memberIds(id);
		if (supportThread.length > 0) {
			await this.dataSource.query(`UPDATE issue_reports SET conversation_id = NULL, chat_open = false, updated_at = now() WHERE conversation_id = $1`, [id]);
		}
		await this.dataSource.query(`DELETE FROM chat_conversations WHERE id = $1`, [id]);
		await this.dataSource.query(`DELETE FROM notifications WHERE kind = 'message' AND url = $1`, [`/chat/${id}`]).catch(() => undefined);
		this.publish(members, { type: "changed", conversationId: id });
	}

	async markRead(userId: string, id: string, announce = true): Promise<void> {
		await this.dataSource.query(`UPDATE chat_members SET last_read_at = now() WHERE conversation_id = $1 AND user_id = $2`, [id, userId]);
		await this.dataSource.query(`DELETE FROM notifications WHERE user_id = $1 AND kind = 'message' AND url = $2`, [userId, `/chat/${id}`]).catch(() => undefined);
		if (announce) {
			this.publish([userId], { type: "changed", conversationId: id });
		}
	}

	async send(
		userId: string,
		id: string,
		text: unknown,
		encrypted = false,
		mlsWelcome?: {
			recipients: Array<{ deviceId: string; keyPackageId: string }>;
			welcome: string;
			ratchetTree: string;
		},
		mlsDeviceId?: string,
	): Promise<ChatMessage> {
		const body = encrypted ? cleanEncryptedMessage(text) : cleanMessage(text);
		if (mlsWelcome && !encrypted) throw new BadRequest("MLS Welcomes can only accompany encrypted chat messages.");
		if (encrypted && (!mlsDeviceId || !UUID_PATTERN.test(mlsDeviceId))) {
			throw new BadRequest("Encrypted chat messages must include the sending device ID.");
		}
		const member = await this.assertMember(userId, id);
		const supportThread = (await this.dataSource.query(
			`SELECT r.id, r.user_id, r.chat_open,
				COALESCE((s.value #>> '{}')::boolean, false) AS chat_enabled
			FROM issue_reports r
			LEFT JOIN settings s ON s.key = 'issue_reports_chat_enabled'
			WHERE r.conversation_id = $1`,
			[id],
		)) as Array<{ id: string; user_id: string; chat_open: boolean; chat_enabled: boolean }>;
		const support = supportThread[0];
		if (support && (!support.chat_open || !support.chat_enabled)) {
			throw new Forbidden("This issue's live chat is closed.");
		}
		if (support && member.kind === "group") {
			await this.ensureSupportRequester(id, support.user_id);
		}
		this.throttle(userId);
		const messageId = randomUUID();
		await this.dataSource.transaction(async (manager) => {
			const rows = (await manager.query(`SELECT encryption_mode FROM chat_conversations WHERE id = $1 FOR SHARE`, [id])) as Array<{
				encryption_mode: "encrypted" | "plaintext";
			}>;
			if (!rows[0]) throw new NotFound("Conversation not found.");
			if ((rows[0].encryption_mode === "encrypted") !== encrypted) {
				throw new BadRequest(
					rows[0].encryption_mode === "encrypted"
						? "This conversation requires end-to-end encrypted messages."
						: "This conversation has been switched to plaintext messages.",
				);
			}
			if (encrypted) {
				const device = (await manager.query(
					`SELECT id FROM chat_mls_devices WHERE id = $1 AND user_id = $2 AND status = 'active'`,
					[mlsDeviceId, userId],
				)) as Array<{ id: string }>;
				if (!device[0]) throw new Forbidden("This chat device is not active.");
			}
			await manager.query(
				`INSERT INTO chat_messages (id, conversation_id, user_id, kind, body, encrypted) VALUES ($1, $2, $3, 'text', $4, $5)`,
				[messageId, id, userId, body, encrypted],
			);
			if (mlsWelcome) {
				await this.storeMlsWelcomeRows(
					manager,
					userId,
					id,
					messageId,
					mlsWelcome.recipients,
					mlsWelcome.welcome,
					mlsWelcome.ratchetTree,
				);
			}
			if (encrypted) {
				const activeDevices = (await manager.query(
					`SELECT d.id AS device_id FROM chat_members m
					JOIN chat_mls_devices d ON d.user_id = m.user_id AND d.status = 'active'
					WHERE m.conversation_id = $1 AND d.id <> $2`,
					[id, mlsDeviceId],
				)) as Array<{ device_id: string }>;
				const deliveries = (await manager.query(
					`SELECT device_id FROM chat_mls_welcomes WHERE message_id = $1`,
					[messageId],
				)) as Array<{ device_id: string }>;
				const expectedDevices = new Set(activeDevices.map(({ device_id }) => device_id));
				const deliveredDevices = new Set(deliveries.map(({ device_id }) => device_id));
				if (deliveredDevices.size !== deliveries.length || expectedDevices.size !== deliveredDevices.size || [...expectedDevices].some((deviceId) => !deliveredDevices.has(deviceId))) {
					throw new Conflict("Encrypted chat messages must include a Welcome for every other active chat device.");
				}
			}
			await manager.query(`UPDATE chat_conversations SET last_message_at = now() WHERE id = $1`, [id]);
			await manager.query(`UPDATE issue_reports SET updated_at = now() WHERE conversation_id = $1`, [id]);
			await manager.query(`UPDATE chat_members SET last_read_at = now() WHERE conversation_id = $1 AND user_id = $2`, [id, userId]);
		});
		const row = (await this.dataSource.query(`${MESSAGE_SELECT} WHERE m.id = $1`, [messageId])) as MessageRow[];
		const message = messageOf(row[0]);
		await this.notify(id, userId, message).catch((error: unknown) => logger().warn("Could not notify chat members.", error));
		this.publish(await this.memberIds(id), { type: "changed", conversationId: id });
		return message;
	}

	/** Unread messages across every conversation, for the navbar badge. */
	async unreadCount(userId: string): Promise<number> {
		const rows = (await this.dataSource.query(
			`SELECT count(*)::int AS n FROM chat_messages msg JOIN chat_members m ON m.conversation_id = msg.conversation_id
			WHERE m.user_id = $1 AND msg.kind = 'text' AND msg.created_at > m.last_read_at AND msg.user_id IS DISTINCT FROM $1`,
			[userId],
		)) as Array<{ n: number }>;
		return rows[0]?.n ?? 0;
	}

	async encryptionStatus(): Promise<{ enabled: boolean; supported: boolean; allowUserDowngrade: boolean }> {
		const rows = (await this.dataSource.query(
			`SELECT
				(SELECT value FROM settings WHERE key = 'chat_e2ee_enabled') AS enabled,
				(SELECT value FROM settings WHERE key = 'chat_user_downgrade_enabled') AS allow_user_downgrade`,
		)) as Array<{ enabled: unknown; allow_user_downgrade: unknown }>;
		if (!rows[0] || typeof rows[0].enabled !== "boolean" || typeof rows[0].allow_user_downgrade !== "boolean") {
			throw new Error("The chat_e2ee_enabled setting is missing or invalid.");
		}
		return { enabled: rows[0].enabled, supported: true, allowUserDowngrade: rows[0].allow_user_downgrade };
	}

	private async notify(id: string, senderId: string, message: ChatMessage): Promise<void> {
		const recipients = (await this.dataSource.query(
			`SELECT m.user_id FROM chat_members m JOIN users u ON u.id = m.user_id
			WHERE m.conversation_id = $1 AND m.user_id <> $2 AND u.disabled_at IS NULL
			AND m.last_read_at < now() - ($3 || ' milliseconds')::interval`,
			[id, senderId, String(ACTIVE_MS)],
		)) as Array<{ user_id: string }>;
		if (recipients.length === 0) {
			return;
		}
		const info = (await this.dataSource.query(`SELECT kind, name FROM chat_conversations WHERE id = $1`, [id])) as Array<{ kind: string; name: string | null }>;
		const sender = message.sender?.displayName ?? "Someone";
		const title = info[0]?.kind === "group" ? `${info[0].name}` : sender;
		const body = "You have a new chat message.";
		const ids = recipients.map((row) => row.user_id);
		const url = `/chat/${id}`;
		// One inbox entry per conversation: a newer message replaces the unread one instead of piling up.
		await this.dataSource.query(`DELETE FROM notifications WHERE kind = 'message' AND url = $1 AND read_at IS NULL AND user_id = ANY($2::uuid[])`, [url, ids]);
		await this.notifications.send({ kind: "message", title, body: body.slice(0, 500), url }, ids);
	}

	private throttle(userId: string): void {
		const now = Date.now();
		const recent = (this.recentSends.get(userId) ?? []).filter((at) => now - at < RATE_WINDOW_MS);
		if (recent.length >= RATE_LIMIT) {
			throw new TooManyRequests("You're sending messages too quickly.");
		}
		recent.push(now);
		this.recentSends.set(userId, recent);
	}

	private date(value: string | undefined): Date | null {
		if (!value) {
			return null;
		}
		const parsed = new Date(value);
		if (Number.isNaN(parsed.getTime())) {
			throw new BadRequest("That timestamp isn't valid.");
		}
		return parsed;
	}

	private sequence(value: string | undefined): string | null {
		if (value === undefined) return null;
		if (!/^[1-9]\d{0,18}$/.test(value) || BigInt(value) > 9_223_372_036_854_775_807n) {
			throw new BadRequest("That message cursor isn't valid.");
		}
		return value;
	}

	private async system(conversationId: string, userId: string | null, body: string): Promise<void> {
		await this.dataSource.transaction(async (manager) => {
			const rows = (await manager.query(
				`SELECT value FROM settings WHERE key = $1 FOR SHARE`,
				["chat_e2ee_enabled"],
			)) as Array<{ value: unknown }>;
			if (!rows[0] || typeof rows[0].value !== "boolean") {
				throw new Error("The chat_e2ee_enabled setting is missing or invalid.");
			}
			if (rows[0].value) return;
			await manager.query(
				`INSERT INTO chat_messages (id, conversation_id, user_id, kind, body) VALUES ($1, $2, $3, 'system', $4)`,
				[randomUUID(), conversationId, userId, body.slice(0, MAX_MESSAGE_LENGTH)],
			);
			await manager.query(`UPDATE chat_conversations SET last_message_at = now() WHERE id = $1`, [conversationId]);
		});
	}

	private async assertMember(userId: string, id: string): Promise<{ kind: "direct" | "group"; role: string }> {
		const rows = (await this.dataSource.query(
			`SELECT c.kind, m.role FROM chat_conversations c JOIN chat_members m ON m.conversation_id = c.id
			WHERE c.id = $1 AND m.user_id = $2`,
			[id, userId],
		)) as Array<{ kind: "direct" | "group"; role: string }>;
		if (!rows[0]) {
			throw new NotFound("Conversation not found.");
		}
		return rows[0];
	}

	/** Finds active, visible people by username. Hidden profiles can't be started a chat with. */
	private async resolve(usernames: string[], viewerId: string): Promise<PersonRow[]> {
		const names = [...new Set(usernames.map((name) => String(name).trim().toLowerCase()).filter(Boolean))].slice(0, MAX_GROUP_MEMBERS);
		if (names.length === 0) {
			throw new BadRequest("Pick at least one person.");
		}
		const rows = (await this.dataSource.query(
			`SELECT u.id, u.username, u.display_name, up.avatar_file FROM users u LEFT JOIN user_preferences up ON up.user_id = u.id
			WHERE lower(u.username) = ANY($1::text[]) AND u.disabled_at IS NULL AND (
				u.id = $2 OR COALESCE(up.profile_visibility, 'public') = 'public'
				OR (COALESCE(up.profile_visibility, 'public') = 'friends' AND EXISTS (
					SELECT 1 FROM social_friendships sf
					WHERE sf.accepted_at IS NOT NULL
					AND ((sf.user_low_id = $2 AND sf.user_high_id = u.id) OR (sf.user_high_id = $2 AND sf.user_low_id = u.id))
				))
			)`,
			[names, viewerId],
		)) as PersonRow[];
		if (rows.length !== names.length) {
			throw new NotFound("One of those people couldn't be found.");
		}
		return rows;
	}

	private async summaries(userId: string, ids: string[]): Promise<ChatConversation[]> {
		if (ids.length === 0) {
			return [];
		}
		const [conversations, members, lastMessages, unread] = await Promise.all([
			this.dataSource.query(
				`SELECT c.id, c.kind, c.name, c.encryption_mode, c.last_message_at,
					(SELECT r.chat_open FROM issue_reports r WHERE r.conversation_id = c.id LIMIT 1) AS support_chat_open
				FROM chat_conversations c WHERE c.id = ANY($1::uuid[])`,
				[ids],
			),
			this.dataSource.query(
				`SELECT m.conversation_id, m.role, u.id, u.username, u.display_name, up.avatar_file
				FROM chat_members m JOIN users u ON u.id = m.user_id LEFT JOIN user_preferences up ON up.user_id = u.id
				WHERE m.conversation_id = ANY($1::uuid[]) ORDER BY m.joined_at ASC`,
				[ids],
			),
			this.dataSource.query(`${MESSAGE_SELECT.replace("SELECT", "SELECT DISTINCT ON (m.conversation_id)")} WHERE m.conversation_id = ANY($1::uuid[]) ORDER BY m.conversation_id, m.sequence DESC`, [ids]),
			this.dataSource.query(
				`SELECT msg.conversation_id, count(*)::int AS n FROM chat_messages msg
				JOIN chat_members m ON m.conversation_id = msg.conversation_id AND m.user_id = $1
				WHERE msg.conversation_id = ANY($2::uuid[]) AND msg.kind = 'text' AND msg.created_at > m.last_read_at AND msg.user_id IS DISTINCT FROM $1
				GROUP BY msg.conversation_id`,
				[userId, ids],
			),
		]);
		const membersBy = new Map<string, ChatMember[]>();
		for (const row of members as Array<PersonRow & { conversation_id: string; role: "owner" | "member" }>) {
			const list = membersBy.get(row.conversation_id) ?? [];
			list.push({ ...personOf(row), role: row.role });
			membersBy.set(row.conversation_id, list);
		}
		const lastBy = new Map((lastMessages as MessageRow[]).map((row) => [row.conversation_id, messageOf(row)]));
		const unreadBy = new Map((unread as Array<{ conversation_id: string; n: number }>).map((row) => [row.conversation_id, row.n]));
		return (
			conversations as Array<{
				id: string;
				kind: "direct" | "group";
				name: string | null;
				encryption_mode: "encrypted" | "plaintext";
				last_message_at: Date;
				support_chat_open: boolean | null;
			}>
		)
			.map((row) => ({
				id: row.id,
				kind: row.kind,
				encryptionMode: row.encryption_mode,
				name: row.name,
				supportChatOpen: row.support_chat_open,
				members: membersBy.get(row.id) ?? [],
				lastMessage: lastBy.get(row.id) ?? null,
				unread: unreadBy.get(row.id) ?? 0,
				updatedAt: row.last_message_at.toISOString(),
			}))
			.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
	}
}
