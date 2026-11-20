import { Inject, Injectable, logger } from "@tsed/di";
import { BadRequest, Conflict, Forbidden, NotFound, TooManyRequests } from "@tsed/exceptions";
import { createPublicKey, randomUUID, verify } from "node:crypto";
import { DataSource, EntityManager, In, IsNull, Not } from "typeorm";
import { ChatMember as ChatMemberEntity, ChatMessage as ChatMessageEntity } from "../entities/chat.entity.js";
import { ChatConversation as ChatConversationEntity } from "../entities/chatConversation.entity.js";
import { ChatMlsDevice, ChatMlsHistoryBackup, ChatMlsKeyPackage, ChatMlsWelcome } from "../entities/chatMls.entity.js";
import { IssueReport } from "../entities/issueReport.entity.js";
import { Notification } from "../entities/notification.entity.js";
import { Setting } from "../entities/setting.entity.js";
import { User } from "../entities/user.entity.js";
import { UserPreference } from "../entities/userPreference.entity.js";
import { DefaultDataSource } from "../datasources/defaultDataSource.datasource.js";
import { NotificationService } from "../api/notifications/notificationService.js";

export const MAX_MESSAGE_LENGTH = 2000;
const MAX_ENCRYPTED_MESSAGE_LENGTH = 32768;
const MAX_MLS_PAYLOAD_LENGTH = 32768;
const MAX_MLS_HISTORY_BACKUP_LENGTH = 29_000_000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_GROUP_MEMBERS = 50;
const MAX_GROUP_NAME = 60;
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

	if (typeof value !== "string" || value.length === 0 || value.length > MAX_ENCRYPTED_MESSAGE_LENGTH || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
		throw new BadRequest(`Encrypted messages must be valid base64 up to ${MAX_ENCRYPTED_MESSAGE_LENGTH} characters.`);
	}
	return value;

}

function cleanMlsPayload(value: unknown, label: string): string {

	if (typeof value !== "string" || value.length === 0 || value.length > MAX_MLS_PAYLOAD_LENGTH || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
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
		const rows = await this.dataSource.getRepository(ChatMemberEntity).find({ select: { userId: true }, where: { conversationId: id } });
		return rows.map((row) => row.userId);
	}

	private messageQuery() {
		return this.dataSource.getRepository(ChatMessageEntity).createQueryBuilder("m").leftJoin(User, "u", "u.id = m.userId").leftJoin(UserPreference, "up", "up.userId = u.id").select("m.id", "id").addSelect("m.sequence", "sequence").addSelect("m.conversationId", "conversation_id").addSelect("m.kind", "kind").addSelect("m.encrypted", "encrypted").addSelect("m.body", "body").addSelect("m.createdAt", "created_at").addSelect("u.username", "username").addSelect("u.displayName", "display_name").addSelect("up.avatarFile", "avatar_file");
	}

	/** Tells members (plus anyone just removed) to refresh a conversation. */
	private async changed(id: string, extra: string[] = []): Promise<void> {
		const ids = new Set([...(await this.memberIds(id)), ...extra]);
		this.publish([...ids], { type: "changed", conversationId: id });
	}

	private async defaultEncryptionMode(manager: EntityManager): Promise<"encrypted" | "plaintext"> {
		const setting = await manager.findOne(Setting, { select: { value: true }, where: { key: "chat_e2ee_enabled" }, lock: { mode: "pessimistic_read" } });
		if (!setting || typeof setting.value !== "boolean") {
			throw new Error("The chat_e2ee_enabled setting is missing or invalid.");
		}
		return setting.value ? "encrypted" : "plaintext";
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

	private async setEncryptionMode(userId: string, id: string, encryptionMode: "encrypted" | "plaintext"): Promise<boolean> {
		return this.dataSource.transaction(async (manager) => {
			const conversation = await manager.createQueryBuilder(ChatConversationEntity, "conversation").innerJoin(ChatMemberEntity, "member", "member.conversationId = conversation.id AND member.userId = :userId", { userId }).select(["conversation.id", "conversation.encryptionMode"]).where("conversation.id = :id", { id }).setLock("pessimistic_write", undefined, ["conversation", "member"]).getOne();
			if (!conversation) throw new NotFound("Conversation not found.");
			if (encryptionMode === "plaintext") {
				const setting = await manager.findOne(Setting, { select: { value: true }, where: { key: "chat_user_downgrade_enabled" }, lock: { mode: "pessimistic_read" } });
				if (!setting) throw new NotFound("Conversation not found.");
				if (setting.value !== true) throw new Forbidden("Your server administrator has not enabled plaintext chat switching.");
			}
			if (conversation.encryptionMode === encryptionMode) return false;
			await manager.getRepository(ChatConversationEntity).update({ id }, { encryptionMode });
			const notice = encryptionMode === "plaintext" ? "Switched this conversation to plaintext. Future messages are readable by the server." : "Switched this conversation to end-to-end encryption. Earlier plaintext messages remain readable by the server.";
			await manager.getRepository(ChatMessageEntity).insert({ id: randomUUID(), conversationId: id, userId, kind: "system", body: notice, encrypted: false });
			await manager.getRepository(ChatConversationEntity).update({ id }, { lastMessageAt: () => "now()" });
			return true;
		});
	}

	async conversations(userId: string): Promise<{ conversations: ChatConversation[]; unread: number }> {
		const ids = await this.dataSource.getRepository(ChatConversationEntity).createQueryBuilder("conversation").innerJoin(ChatMemberEntity, "member", "member.conversationId = conversation.id").select("conversation.id", "id").where("member.userId = :userId", { userId }).orderBy("conversation.lastMessageAt", "DESC").take(200).getRawMany<{ id: string }>();
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

	async registerMlsDevice(userId: string, deviceId: string, name: unknown, keyPackage: unknown, pairingPublicKey: unknown): Promise<{ deviceId: string; keyPackageId: string; status: "active" | "pending"; approvalChallenge: string | null }> {
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
			await manager.createQueryBuilder(User, "user").select("user.id").where("user.id = :userId", { userId }).setLock("pessimistic_write").getRawOne();
			const existing = await manager.getRepository(ChatMlsDevice).createQueryBuilder("device").select("device.userId", "user_id").addSelect("device.status", "status").addSelect("device.pairingPublicKey", "pairing_public_key").addSelect("device.approvalChallenge", "approval_challenge").where("device.id = :deviceId", { deviceId }).setLock("pessimistic_write").getRawOne<{ user_id: string; status: string; pairing_public_key: string | null; approval_challenge: string | null }>();
			if (existing && existing.user_id !== userId) {
				throw new Conflict("That chat device is already registered to another account.");
			}
			if (existing?.status === "revoked") {
				throw new Conflict("That chat device has been revoked.");
			}
			if (existing?.pairing_public_key && existing.pairing_public_key !== pairingPublicKey) {
				throw new Conflict("That chat device is already registered with a different pairing key.");
			}

			const status = "active";
			if (existing) {
				await manager.update(ChatMlsDevice, { id: deviceId }, { name: label, status, approvalChallenge: null, approvedAt: () => 'COALESCE("approved_at", now())', pairingPublicKey });
			} else {
				const approvalChallenge = null;
				await manager.insert(ChatMlsDevice, { id: deviceId, userId, name: label, status, pairingPublicKey, approvalChallenge, approvedAt: () => "now()" });
			}
			const packages = manager.getRepository(ChatMlsKeyPackage);
			const existingPackage = await packages.findOne({ select: { id: true }, where: { deviceId, keyPackage: serializedKeyPackage }, order: { createdAt: "DESC" } });
			const keyPackageId = existingPackage?.id ?? randomUUID();
			if (!existingPackage) {
				await packages.insert({ id: keyPackageId, deviceId, keyPackage: serializedKeyPackage });
			}
			return { deviceId, keyPackageId, status, approvalChallenge: null };
		});
	}

	async listMlsDevices(userId: string): Promise<ChatMlsDeviceSummary[]> {
		const rows = await this.dataSource.getRepository(ChatMlsDevice).find({
			select: { id: true, name: true, status: true, createdAt: true, approvedAt: true, approvalChallenge: true },
			where: { userId },
			order: { createdAt: "ASC" },
		});
		return rows.map((row) => ({
			deviceId: row.id,
			name: row.name,
			status: row.status as ChatMlsDeviceSummary["status"],
			createdAt: row.createdAt.toISOString(),
			approvedAt: row.approvedAt?.toISOString() ?? null,
			approvalChallenge: row.approvalChallenge,
		}));
	}

	async chatHistoryBackup(userId: string): Promise<string | null> {
		const row = await this.dataSource.getRepository(ChatMlsHistoryBackup).findOne({ select: { backup: true }, where: { userId } });
		return row?.backup ?? null;
	}

	async saveChatHistoryBackup(userId: string, backup: unknown): Promise<void> {
		if (typeof backup !== "string" || backup.length === 0 || backup.length > MAX_MLS_HISTORY_BACKUP_LENGTH) {
			throw new BadRequest("The encrypted chat history backup is invalid or too large.");
		}
		await this.dataSource.getRepository(ChatMlsHistoryBackup).upsert({ userId, backup, updatedAt: () => "now()" }, ["userId"]);
	}

	async revokeMlsDevice(userId: string, deviceId: string): Promise<void> {
		await this.dataSource.transaction(async (manager) => {
			const result = await manager.update(ChatMlsDevice, { id: deviceId, userId, status: Not("revoked") }, { status: "revoked", revokedAt: () => "now()" });
			if (!result.affected) {
				const existing = await manager.getRepository(ChatMlsDevice).exists({ where: { id: deviceId, userId } });
				if (!existing) throw new NotFound("Chat device not found.");
				return;
			}
			await manager.update(ChatMlsKeyPackage, { deviceId }, { usedAt: () => 'COALESCE("used_at", now())' });
		});
	}

	async approveMlsDevice(userId: string, approverDeviceId: string, targetDeviceId: string, signature: unknown): Promise<void> {
		if (typeof signature !== "string" || signature.length > 256 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(signature)) {
			throw new BadRequest("The device approval signature is invalid.");
		}
		await this.dataSource.transaction(async (manager) => {
			const target = await manager.getRepository(ChatMlsDevice).createQueryBuilder("target").innerJoin(ChatMlsDevice, "approver", "approver.userId = target.userId").select("target.approvalChallenge", "approval_challenge").addSelect("approver.pairingPublicKey", "pairing_public_key").where("target.id = :targetDeviceId AND target.userId = :userId AND target.status = 'pending'", { targetDeviceId, userId }).andWhere("approver.id = :approverDeviceId AND approver.status = 'active'", { approverDeviceId }).setLock("pessimistic_write", undefined, ["target"]).getRawOne<{ approval_challenge: string | null; pairing_public_key: string }>();
			if (!target?.approval_challenge) throw new NotFound("That pending chat device was not found.");
			const payload = Buffer.from(`flixer-chat-device-approval:v1:${targetDeviceId}:${target.approval_challenge}`);
			let valid = false;
			try {
				valid = verify("sha256", payload, { key: Buffer.from(target.pairing_public_key, "base64"), format: "der", type: "spki", dsaEncoding: "ieee-p1363" }, Buffer.from(signature, "base64"));
			} catch {
				throw new BadRequest("The device approval signature could not be verified.");
			}
			if (!valid) throw new Forbidden("Approval must be signed by a trusted device on this account.");
			await manager.getRepository(ChatMlsDevice).update({ id: targetDeviceId }, { status: "active", approvedAt: () => "now()", approvalChallenge: null });
		});
	}

	async addMlsKeyPackage(userId: string, deviceId: string, keyPackage: unknown): Promise<{ keyPackageId: string }> {
		const serializedKeyPackage = cleanMlsPayload(keyPackage, "The MLS key package");
		if (!(await this.dataSource.getRepository(ChatMlsDevice).exists({ where: { id: deviceId, userId, status: "active" } }))) throw new NotFound("Active chat device not found.");
		const packages = this.dataSource.getRepository(ChatMlsKeyPackage);
		const duplicate = await packages.findOne({ select: { id: true }, where: { deviceId, keyPackage: serializedKeyPackage }, order: { createdAt: "DESC" } });
		if (duplicate) return { keyPackageId: duplicate.id };
		const keyPackageId = randomUUID();
		await packages.insert({ id: keyPackageId, deviceId, keyPackage: serializedKeyPackage });
		return { keyPackageId };
	}

	async deviceMlsKeyPackages(userId: string, deviceId: string): Promise<Array<{ keyPackageId: string; keyPackage: string; available: boolean }>> {
		const rows = await this.dataSource.getRepository(ChatMlsDevice).createQueryBuilder("device").innerJoin(ChatMlsKeyPackage, "keyPackage", "keyPackage.deviceId = device.id").select("keyPackage.id", "id").addSelect("keyPackage.keyPackage", "key_package").addSelect("keyPackage.usedAt IS NULL", "available").where("device.id = :deviceId AND device.userId = :userId AND device.status = 'active'", { deviceId, userId }).orderBy("keyPackage.createdAt", "ASC").getRawMany<{ id: string; key_package: string; available: boolean }>();
		if (!rows.length) {
			if (!(await this.dataSource.getRepository(ChatMlsDevice).exists({ where: { id: deviceId, userId, status: "active" } }))) throw new NotFound("Active chat device not found.");
		}
		return rows.map((row) => ({ keyPackageId: row.id, keyPackage: row.key_package, available: row.available }));
	}

	async conversationMlsKeyPackages(userId: string, conversationId: string, lenient = false): Promise<Array<{ userId: string; deviceId: string; keyPackageId: string; keyPackage: string; available: boolean }>> {
		const member = await this.assertMember(userId, conversationId);
		if (member.kind === "group") {
			const support = await this.dataSource.getRepository(IssueReport).find({ select: { userId: true }, where: { conversationId } });
			if (support[0]) await this.ensureSupportRequester(conversationId, support[0].userId);
		}
		// Joiners only need the identity directory, so they skip the "everyone has a spare key package" check.
		const readiness = lenient
			? []
			: await this.dataSource
					.getRepository(ChatMemberEntity)
					.createQueryBuilder("member")
					.leftJoin(ChatMlsDevice, "device", "device.userId = member.userId AND device.status = 'active'")
					.leftJoin(ChatMlsKeyPackage, "keyPackage", "keyPackage.deviceId = device.id AND keyPackage.usedAt IS NULL")
					.select("member.userId", "user_id")
					.addSelect("COUNT(DISTINCT device.id)::int", "device_count")
					// RAW SQL: PostgreSQL FILTER counts devices with at least one unused package.
					.addSelect("COUNT(DISTINCT device.id) FILTER (WHERE keyPackage.id IS NOT NULL)::int", "ready_count")
					.where("member.conversationId = :conversationId", { conversationId })
					.groupBy("member.userId")
					.getRawMany<{ user_id: string; device_count: number; ready_count: number }>();
		if (readiness.some((row) => row.device_count === 0 || row.ready_count < row.device_count)) {
			throw new Conflict("Every active chat device needs an unused MLS key package. Ask each member to open Flixer and try again.");
		}
		const rows = await this.dataSource.getRepository(ChatMemberEntity).createQueryBuilder("member").innerJoin(ChatMlsDevice, "device", "device.userId = member.userId AND device.status = 'active'").innerJoin(ChatMlsKeyPackage, "keyPackage", "keyPackage.deviceId = device.id").select("device.userId", "user_id").addSelect("device.id", "device_id").addSelect("keyPackage.id", "key_package_id").addSelect("keyPackage.keyPackage", "key_package").addSelect("keyPackage.usedAt IS NULL", "available").where("member.conversationId = :conversationId", { conversationId }).orderBy("device.userId", "ASC").addOrderBy("device.createdAt", "ASC").addOrderBy("keyPackage.createdAt", "ASC").getRawMany<{ user_id: string; device_id: string; key_package_id: string; key_package: string; available: boolean }>();
		return rows.map((row) => ({
			userId: row.user_id,
			deviceId: row.device_id,
			keyPackageId: row.key_package_id,
			keyPackage: row.key_package,
			available: row.available,
		}));
	}

	async claimMlsKeyPackage(
		userId: string,
		conversationId: string,
		keyPackageId: string,
	): Promise<{
		userId: string;
		deviceId: string;
		keyPackageId: string;
		keyPackage: string;
		available: false;
	}> {
		await this.assertMember(userId, conversationId);
		return this.dataSource.transaction(async (manager) => {
			const candidate = await manager.getRepository(ChatMlsKeyPackage).createQueryBuilder("keyPackage").innerJoin(ChatMlsDevice, "device", "device.id = keyPackage.deviceId").innerJoin(ChatMemberEntity, "member", "member.userId = device.userId").select("device.userId", "user_id").addSelect("device.id", "device_id").addSelect("keyPackage.id", "key_package_id").addSelect("keyPackage.keyPackage", "key_package").where("keyPackage.id = :keyPackageId AND keyPackage.usedAt IS NULL", { keyPackageId }).andWhere("device.status = 'active'").andWhere("member.conversationId = :conversationId", { conversationId }).getRawOne<{ user_id: string; device_id: string; key_package_id: string; key_package: string }>();
			if (!candidate) throw new Conflict("That MLS key package was already used or is no longer available.");
			// RAW SQL: correlated membership and active-device EXISTS predicates keep the one-time claim atomic.
			const result = await manager
				.createQueryBuilder()
				.update(ChatMlsKeyPackage)
				.set({ usedAt: () => "now()" })
				.where('"id" = :keyPackageId AND "device_id" = :deviceId AND "used_at" IS NULL AND EXISTS (SELECT 1 FROM "chat_mls_devices" d WHERE d."id" = "chat_mls_key_packages"."device_id" AND d."status" = \'active\' AND EXISTS (SELECT 1 FROM "chat_members" m WHERE m."user_id" = d."user_id" AND m."conversation_id" = :conversationId))', { keyPackageId, deviceId: candidate.device_id, conversationId })
				.execute();
			if (!result.affected) throw new Conflict("That MLS key package was already used or is no longer available.");
			return { userId: candidate.user_id, deviceId: candidate.device_id, keyPackageId: candidate.key_package_id, keyPackage: candidate.key_package, available: false };
		});
	}

	async storeMlsWelcome(userId: string, conversationId: string, messageId: string, recipients: Array<{ deviceId: string; keyPackageId: string }>, welcome: unknown, ratchetTree: unknown): Promise<void> {
		await this.assertMember(userId, conversationId);
		await this.dataSource.transaction((manager) => this.storeMlsWelcomeRows(manager, userId, conversationId, messageId, recipients, welcome, ratchetTree));
	}

	private async storeMlsWelcomeRows(manager: EntityManager, userId: string, conversationId: string, messageId: string, recipients: Array<{ deviceId: string; keyPackageId: string }>, welcome: unknown, ratchetTree: unknown): Promise<void> {
		const serializedWelcome = cleanMlsPayload(welcome, "The MLS Welcome message");
		const serializedTree = cleanMlsPayload(ratchetTree, "The MLS ratchet tree");
		if (!UUID_PATTERN.test(messageId) || !Array.isArray(recipients) || recipients.length === 0 || recipients.length > 200) {
			throw new BadRequest("The MLS Welcome recipients or message ID are invalid.");
		}
		const uniqueRecipients = new Map(recipients.map(({ deviceId, keyPackageId }) => [`${deviceId}:${keyPackageId}`, { deviceId, keyPackageId }]));
		if (uniqueRecipients.size !== recipients.length || recipients.some(({ deviceId, keyPackageId }) => !UUID_PATTERN.test(deviceId) || !UUID_PATTERN.test(keyPackageId))) {
			throw new BadRequest("The MLS Welcome recipients are invalid.");
		}
		if (!(await manager.getRepository(ChatMessageEntity).exists({ where: { id: messageId, conversationId, userId, kind: "text" } }))) throw new NotFound("The encrypted chat message was not found.");
		const packageIds = recipients.map(({ keyPackageId }) => keyPackageId);
		const deviceIds = recipients.map(({ deviceId }) => deviceId);
		const welcomeIds = recipients.map(() => randomUUID());
		const valid = await manager.getRepository(ChatMlsDevice).createQueryBuilder("device").innerJoin(ChatMlsKeyPackage, "keyPackage", "keyPackage.deviceId = device.id").innerJoin(ChatMemberEntity, "member", "member.userId = device.userId").select("device.id", "device_id").addSelect("keyPackage.id", "key_package_id").where("member.conversationId = :conversationId", { conversationId }).andWhere("device.status = 'active'").andWhere("device.id IN (:...deviceIds)", { deviceIds }).andWhere("keyPackage.id IN (:...packageIds)", { packageIds }).andWhere("keyPackage.usedAt IS NOT NULL").getRawMany<{ device_id: string; key_package_id: string }>();
		const validPairs = new Set(valid.map((row) => `${row.device_id}:${row.key_package_id}`));
		if (validPairs.size !== recipients.length || recipients.some(({ deviceId, keyPackageId }) => !validPairs.has(`${deviceId}:${keyPackageId}`))) {
			throw new BadRequest("Every MLS Welcome recipient must be an active device with a claimed key package in this conversation.");
		}
		await manager
			.createQueryBuilder()
			.insert()
			.into(ChatMlsWelcome)
			.values(recipients.map(({ deviceId, keyPackageId }, index) => ({ id: welcomeIds[index], conversationId, deviceId, keyPackageId, messageId, welcome: serializedWelcome, ratchetTree: serializedTree })))
			.orIgnore()
			.execute();
		const rows = await manager.getRepository(ChatMlsWelcome).find({
			select: { messageId: true, welcome: true, ratchetTree: true },
			where: { conversationId, keyPackageId: In(packageIds) },
		});
		if (rows.length !== recipients.length || rows.some((row) => row.messageId !== messageId || row.welcome !== serializedWelcome || row.ratchetTree !== serializedTree)) {
			throw new Conflict("A different MLS Welcome is already stored for one of these key packages.");
		}
	}

	async pendingMlsWelcomes(userId: string, conversationId: string, deviceId: string): Promise<Array<{ id: string; messageId: string; keyPackageId: string; welcome: string; ratchetTree: string; createdAt: string }>> {
		await this.assertMember(userId, conversationId);
		if (!(await this.dataSource.getRepository(ChatMlsDevice).exists({ where: { id: deviceId, userId, status: "active" } }))) throw new NotFound("Chat device not found.");
		const rows = await this.dataSource.getRepository(ChatMlsWelcome).find({
			select: { id: true, messageId: true, keyPackageId: true, welcome: true, ratchetTree: true, createdAt: true },
			where: { conversationId, deviceId, consumedAt: IsNull(), messageId: Not(IsNull()) },
			order: { createdAt: "ASC" },
		});
		return rows.map((row) => ({
			id: row.id,
			messageId: row.messageId,
			keyPackageId: row.keyPackageId,
			welcome: row.welcome,
			ratchetTree: row.ratchetTree,
			createdAt: row.createdAt.toISOString(),
		}));
	}

	async acknowledgeMlsWelcome(userId: string, conversationId: string, deviceId: string, welcomeId: string): Promise<void> {
		await this.assertMember(userId, conversationId);
		// RAW SQL: correlated EXISTS keeps ownership and active-device validation in the atomic update.
		const result = await this.dataSource
			.getRepository(ChatMlsWelcome)
			.createQueryBuilder()
			.update(ChatMlsWelcome)
			.set({ consumedAt: () => "now()" })
			.where('"id" = :welcomeId AND "conversation_id" = :conversationId AND "device_id" = :deviceId AND EXISTS (SELECT 1 FROM "chat_mls_devices" d WHERE d."id" = "chat_mls_welcomes"."device_id" AND d."user_id" = :userId AND d."status" = \'active\')', { welcomeId, conversationId, deviceId, userId })
			.execute();
		if (!result.affected) throw new NotFound("MLS Welcome message not found.");
	}

	async startDirect(userId: string, username: string): Promise<ChatConversation> {
		const [other] = await this.resolve([username], userId);
		if (other.id === userId) {
			throw new BadRequest("You can't message yourself.");
		}
		const key = directKey(userId, other.id);
		const existing = await this.dataSource.getRepository(ChatConversationEntity).findOne({ select: { id: true }, where: { directKey: key } });
		if (existing) {
			return this.conversation(userId, existing.id);
		}
		const id = randomUUID();
		await this.dataSource.transaction(async (manager) => {
			const encryptionMode = await this.defaultEncryptionMode(manager);
			await manager.getRepository(ChatConversationEntity).insert({ id, kind: "direct", directKey: key, createdBy: userId, encryptionMode });
			await manager.getRepository(ChatMemberEntity).insert([
				{ conversationId: id, userId, role: "member" },
				{ conversationId: id, userId: other.id, role: "member" },
			]);
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
			await manager.getRepository(ChatConversationEntity).insert({ id, kind: "group", name: title, createdBy: userId, encryptionMode });
			const members = manager.getRepository(ChatMemberEntity);
			await members.insert({ conversationId: id, userId, role: "owner" });
			for (const person of others) {
				await members.insert({ conversationId: id, userId: person.id, role: "member" });
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
			await manager.getRepository(ChatConversationEntity).insert({ id, kind: "group", name: title, createdBy: adminId, encryptionMode });
			const members = manager.getRepository(ChatMemberEntity);
			await members.insert({ conversationId: id, userId: adminId, role: "owner" });
			if (requesterId !== adminId) {
				await members.insert({ conversationId: id, userId: requesterId, role: "member" });
			}
		});
		await this.system(id, adminId, "opened a support chat for this issue");
		await this.changed(id);
		return this.conversation(adminId, id);
	}

	/** Re-adds the issue requester without changing the existing conversation or its message history. */
	async ensureSupportRequester(conversationId: string, requesterId: string): Promise<void> {
		// RAW SQL: CASE and COALESCE expressions preserve role and last-read initialization in INSERT ... SELECT.
		const inserted = await this.dataSource
			.createQueryBuilder()
			.insert()
			.into(ChatMemberEntity, ["conversationId", "userId", "role", "lastReadAt"])
			.valuesFromSelect((query) => query.select("conversation.id").addSelect(":requesterId").addSelect("CASE WHEN conversation.createdBy = :requesterId THEN 'owner' ELSE 'member' END").addSelect("COALESCE((SELECT MAX(message.created_at) FROM chat_messages message WHERE message.conversation_id = conversation.id), now())").from(ChatConversationEntity, "conversation").where("conversation.id = :conversationId").setParameters({ conversationId, requesterId }))
			.orIgnore()
			.returning(["user_id"])
			.execute();
		if (!inserted.raw.length) return;
		await this.system(conversationId, null, "rejoined the issue support chat");
		await this.changed(conversationId, [requesterId]);
	}

	async rename(userId: string, id: string, name: unknown): Promise<ChatConversation> {
		const member = await this.assertMember(userId, id);
		if (member.kind !== "group") {
			throw new BadRequest("Only groups can be renamed.");
		}
		const title = cleanName(name);
		await this.dataSource.getRepository(ChatConversationEntity).update({ id }, { name: title });
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
		const have = new Set(await this.memberIds(id));
		const fresh = people.filter((person) => !have.has(person.id));
		if (have.size + fresh.length > MAX_GROUP_MEMBERS) {
			throw new BadRequest(`Groups can have up to ${MAX_GROUP_MEMBERS} people.`);
		}
		for (const person of fresh) {
			await this.dataSource.getRepository(ChatMemberEntity).createQueryBuilder().insert().values({ conversationId: id, userId: person.id, role: "member" }).orIgnore().execute();
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
		const target = await this.dataSource.getRepository(ChatMemberEntity).createQueryBuilder("member").innerJoin(User, "user", "user.id = member.userId").select("user.id", "id").addSelect("user.username", "username").addSelect("user.displayName", "display_name").addSelect("member.role", "role").where("member.conversationId = :id", { id }).andWhere("LOWER(user.username) = LOWER(:username)", { username }).getRawOne<{ id: string; username: string; display_name: string | null; role: string }>();
		if (!target) {
			throw new NotFound("That person isn't in this group.");
		}
		const leaving = target.id === userId;
		if (!leaving && member.role !== "owner") {
			throw new Forbidden("Only the group owner can remove people.");
		}
		const before = await this.memberIds(id);
		await this.dataSource.getRepository(ChatMemberEntity).delete({ conversationId: id, userId: target.id });
		const remaining = await this.dataSource.getRepository(ChatMemberEntity).find({ select: { userId: true, role: true }, where: { conversationId: id }, order: { joinedAt: "ASC" } });
		if (remaining.length === 0) {
			await this.dataSource.getRepository(IssueReport).update({ conversationId: id }, { conversationId: null, chatOpen: false, updatedAt: () => "now()" });
			await this.dataSource.getRepository(ChatConversationEntity).delete({ id });
			this.publish(before, { type: "changed", conversationId: id });
			return;
		}
		if (!remaining.some((row) => row.role === "owner")) {
			await this.dataSource.getRepository(ChatMemberEntity).update({ conversationId: id, userId: remaining[0].userId }, { role: "owner" });
		}
		const name = target.display_name || target.username;
		await this.system(id, null, leaving ? `${name} left` : `${name} was removed`);
		await this.changed(id, before);
	}

	/** Messages oldest first. `before` pages back through history, `after` fetches what arrived since. Fetching marks the thread read. */
	async messages(userId: string, id: string, options: { before?: string; after?: string; beforeSequence?: string; afterSequence?: string }): Promise<{ messages: ChatMessage[]; hasMore: boolean }> {
		await this.assertMember(userId, id);
		const before = this.date(options.before);
		const after = this.date(options.after);
		const beforeSequence = this.sequence(options.beforeSequence);
		const afterSequence = this.sequence(options.afterSequence);
		const query = this.messageQuery().where("m.conversationId = :conversationId", { conversationId: id });
		if (beforeSequence) {
			query.andWhere("m.sequence < CAST(:beforeSequence AS bigint)", { beforeSequence });
		} else if (before) {
			query.andWhere("m.createdAt < :before", { before });
		}
		if (afterSequence) {
			query.andWhere("m.sequence > CAST(:afterSequence AS bigint)", { afterSequence });
		} else if (after) {
			query.andWhere("m.createdAt > :after", { after });
		}
		const rows = await query
			.orderBy("m.sequence", after || afterSequence ? "ASC" : "DESC")
			.take(PAGE_SIZE + 1)
			.getRawMany<MessageRow>();
		const hasMore = rows.length > PAGE_SIZE;
		const page = rows.slice(0, PAGE_SIZE).map(messageOf);
		await this.markRead(userId, id, false);
		return { messages: after || afterSequence ? page : page.reverse(), hasMore: after || afterSequence ? false : hasMore };
	}

	/** Deletes a conversation for everyone: any direct-chat member, a group owner, or a support-chat member. */
	async deleteConversation(userId: string, id: string): Promise<void> {
		const member = await this.assertMember(userId, id);
		const supportThread = await this.dataSource.getRepository(IssueReport).find({ select: { id: true }, where: { conversationId: id } });
		if (member.kind === "group" && member.role !== "owner" && supportThread.length === 0) {
			throw new Forbidden("Only the group owner can delete it.");
		}
		const members = await this.memberIds(id);
		if (supportThread.length > 0) {
			await this.dataSource.getRepository(IssueReport).update({ conversationId: id }, { conversationId: null, chatOpen: false, updatedAt: () => "now()" });
		}
		await this.dataSource.getRepository(ChatConversationEntity).delete({ id });
		await this.dataSource
			.getRepository(Notification)
			.delete({ kind: "message", url: `/chat/${id}` })
			.catch(() => undefined);
		this.publish(members, { type: "changed", conversationId: id });
	}

	async markRead(userId: string, id: string, announce = true): Promise<void> {
		await this.dataSource.getRepository(ChatMemberEntity).update({ conversationId: id, userId }, { lastReadAt: () => "now()" });
		await this.dataSource
			.getRepository(Notification)
			.delete({ userId, kind: "message", url: `/chat/${id}` })
			.catch(() => undefined);
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
		const support = await this.dataSource
			.getRepository(IssueReport)
			.createQueryBuilder("report")
			.leftJoin(Setting, "setting", "setting.key = 'issue_reports_chat_enabled'")
			.select("report.id", "id")
			.addSelect("report.userId", "user_id")
			.addSelect("report.chatOpen", "chat_open")
			// RAW SQL: JSONB scalar conversion retains the setting's boolean interpretation.
			.addSelect("COALESCE((setting.value #>> '{}')::boolean, false)", "chat_enabled")
			.where("report.conversationId = :id", { id })
			.getRawOne<{ id: string; user_id: string; chat_open: boolean; chat_enabled: boolean }>();
		if (support && (!support.chat_open || !support.chat_enabled)) {
			throw new Forbidden("This issue's live chat is closed.");
		}
		if (support && member.kind === "group") {
			await this.ensureSupportRequester(id, support.user_id);
		}
		this.throttle(userId);
		const messageId = randomUUID();
		await this.dataSource.transaction(async (manager) => {
			const conversation = await manager.findOne(ChatConversationEntity, { select: { encryptionMode: true }, where: { id }, lock: { mode: "pessimistic_read" } });
			if (!conversation) throw new NotFound("Conversation not found.");
			if ((conversation.encryptionMode === "encrypted") !== encrypted) {
				throw new BadRequest(conversation.encryptionMode === "encrypted" ? "This conversation requires end-to-end encrypted messages." : "This conversation has been switched to plaintext messages.");
			}
			if (encrypted) {
				if (!(await manager.getRepository(ChatMlsDevice).exists({ where: { id: mlsDeviceId, userId, status: "active" } }))) throw new Forbidden("This chat device is not active.");
			}
			await manager.getRepository(ChatMessageEntity).insert({ id: messageId, conversationId: id, userId, kind: "text", body, encrypted });
			if (mlsWelcome) {
				await this.storeMlsWelcomeRows(manager, userId, id, messageId, mlsWelcome.recipients, mlsWelcome.welcome, mlsWelcome.ratchetTree);
			}
			if (encrypted) {
				const activeDevices = await manager.getRepository(ChatMemberEntity).createQueryBuilder("member").innerJoin(ChatMlsDevice, "device", "device.userId = member.userId AND device.status = 'active'").select("device.id", "device_id").where("member.conversationId = :id AND device.id <> :mlsDeviceId", { id, mlsDeviceId }).getRawMany<{ device_id: string }>();
				const deliveries = await manager.getRepository(ChatMlsWelcome).find({ select: { deviceId: true }, where: { messageId } });
				const expectedDevices = new Set(activeDevices.map(({ device_id }) => device_id));
				const deliveredDevices = new Set(deliveries.map(({ deviceId }) => deviceId));
				if (deliveredDevices.size !== deliveries.length || expectedDevices.size !== deliveredDevices.size || [...expectedDevices].some((deviceId) => !deliveredDevices.has(deviceId))) {
					throw new Conflict("Encrypted chat messages must include a Welcome for every other active chat device.");
				}
			}
			await manager.getRepository(ChatConversationEntity).update({ id }, { lastMessageAt: () => "now()" });
			await manager.getRepository(IssueReport).update({ conversationId: id }, { updatedAt: () => "now()" });
			await manager.getRepository(ChatMemberEntity).update({ conversationId: id, userId }, { lastReadAt: () => "now()" });
		});
		const row = await this.messageQuery().where("m.id = :messageId", { messageId }).getRawOne<MessageRow>();
		const message = messageOf(row as MessageRow);
		await this.notify(id, userId, message).catch((error: unknown) => logger().warn("Could not notify chat members.", error));
		this.publish(await this.memberIds(id), { type: "changed", conversationId: id });
		return message;
	}

	/** Unread messages across every conversation, for the navbar badge. */
	async unreadCount(userId: string): Promise<number> {
		const result = await this.dataSource.getRepository(ChatMessageEntity).createQueryBuilder("message").innerJoin(ChatMemberEntity, "member", "member.conversationId = message.conversationId").select("COUNT(*)::int", "n").where("member.userId = :userId", { userId }).andWhere("message.kind = 'text'").andWhere("message.createdAt > member.lastReadAt").andWhere("message.userId IS DISTINCT FROM :userId", { userId }).getRawOne<{ n: number }>();
		return result?.n ?? 0;
	}

	async encryptionStatus(): Promise<{ enabled: boolean; supported: boolean; allowUserDowngrade: boolean }> {
		const settings = await this.dataSource.getRepository(Setting).findBy({ key: In(["chat_e2ee_enabled", "chat_user_downgrade_enabled"]) });
		const enabled = settings.find((setting) => setting.key === "chat_e2ee_enabled")?.value;
		const allowUserDowngrade = settings.find((setting) => setting.key === "chat_user_downgrade_enabled")?.value;
		if (typeof enabled !== "boolean" || typeof allowUserDowngrade !== "boolean") {
			throw new Error("The chat_e2ee_enabled setting is missing or invalid.");
		}
		return { enabled, supported: true, allowUserDowngrade };
	}

	private async notify(id: string, senderId: string, message: ChatMessage): Promise<void> {
		const recipients = await this.dataSource
			.getRepository(ChatMemberEntity)
			.createQueryBuilder("member")
			.innerJoin(User, "user", "user.id = member.userId")
			.select("member.userId", "user_id")
			.where("member.conversationId = :id AND member.userId <> :senderId", { id, senderId })
			.andWhere("user.disabledAt IS NULL")
			// RAW SQL: PostgreSQL interval arithmetic uses the database clock.
			.andWhere("member.lastReadAt < now() - (:activeMs || ' milliseconds')::interval", { activeMs: String(ACTIVE_MS) })
			.getRawMany<{ user_id: string }>();
		if (recipients.length === 0) {
			return;
		}
		const info = await this.dataSource.getRepository(ChatConversationEntity).findOne({ select: { kind: true, name: true }, where: { id } });
		const sender = message.sender?.displayName ?? "Someone";
		const title = info?.kind === "group" ? `${info.name}` : sender;
		const body = "You have a new chat message.";
		const ids = recipients.map((row) => row.user_id);
		const url = `/chat/${id}`;
		// One inbox entry per conversation: a newer message replaces the unread one instead of piling up.
		await this.dataSource.getRepository(Notification).delete({ kind: "message", url, readAt: IsNull(), userId: In(ids) });
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
			const setting = await manager.findOne(Setting, { where: { key: "chat_e2ee_enabled" }, lock: { mode: "pessimistic_read" } });
			if (!setting || typeof setting.value !== "boolean") {
				throw new Error("The chat_e2ee_enabled setting is missing or invalid.");
			}
			if (setting.value) return;
			await manager.getRepository(ChatMessageEntity).insert({ id: randomUUID(), conversationId, userId, kind: "system", body: body.slice(0, MAX_MESSAGE_LENGTH) });
			await manager.getRepository(ChatConversationEntity).update({ id: conversationId }, { lastMessageAt: () => "now()" });
		});
	}

	private async assertMember(userId: string, id: string): Promise<{ kind: "direct" | "group"; role: string }> {
		const row = await this.dataSource.getRepository(ChatConversationEntity).createQueryBuilder("conversation").innerJoin(ChatMemberEntity, "member", "member.conversationId = conversation.id").select("conversation.kind", "kind").addSelect("member.role", "role").where("conversation.id = :id AND member.userId = :userId", { id, userId }).getRawOne<{ kind: "direct" | "group"; role: string }>();
		if (!row) {
			throw new NotFound("Conversation not found.");
		}
		return row;
	}

	/** Finds active, visible people by username. Hidden profiles can't be started a chat with. */
	private async resolve(usernames: string[], viewerId: string): Promise<PersonRow[]> {
		const names = [...new Set(usernames.map((name) => String(name).trim().toLowerCase()).filter(Boolean))].slice(0, MAX_GROUP_MEMBERS);
		if (names.length === 0) {
			throw new BadRequest("Pick at least one person.");
		}
		const rows = await this.dataSource
			.getRepository(User)
			.createQueryBuilder("user")
			.leftJoin(UserPreference, "preference", "preference.userId = user.id")
			.select("user.id", "id")
			.addSelect("user.username", "username")
			.addSelect("user.displayName", "display_name")
			.addSelect("preference.avatarFile", "avatar_file")
			.where("LOWER(user.username) IN (:...names)", { names })
			.andWhere("user.disabledAt IS NULL")
			// RAW SQL: correlated friendship EXISTS preserves friends-only visibility.
			.andWhere("(user.id = :viewerId OR COALESCE(preference.profileVisibility, 'public') = 'public' OR (COALESCE(preference.profileVisibility, 'public') = 'friends' AND EXISTS (SELECT 1 FROM social_friendships sf WHERE sf.accepted_at IS NOT NULL AND ((sf.user_low_id = :viewerId AND sf.user_high_id = user.id) OR (sf.user_high_id = :viewerId AND sf.user_low_id = user.id)))))", { viewerId })
			.getRawMany<PersonRow>();
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
			this.dataSource
				.getRepository(ChatConversationEntity)
				.createQueryBuilder("conversation")
				.select("conversation.id", "id")
				.addSelect("conversation.kind", "kind")
				.addSelect("conversation.name", "name")
				.addSelect("conversation.encryptionMode", "encryption_mode")
				.addSelect("conversation.lastMessageAt", "last_message_at")
				// RAW SQL: correlated support-thread scalar subquery preserves optional support state.
				.addSelect((subQuery) => subQuery.select("report.chatOpen").from(IssueReport, "report").where("report.conversationId = conversation.id").take(1), "support_chat_open")
				.where("conversation.id IN (:...ids)", { ids })
				.getRawMany(),
			this.dataSource.getRepository(ChatMemberEntity).createQueryBuilder("member").innerJoin(User, "user", "user.id = member.userId").leftJoin(UserPreference, "preference", "preference.userId = user.id").select("member.conversationId", "conversation_id").addSelect("member.role", "role").addSelect("user.id", "id").addSelect("user.username", "username").addSelect("user.displayName", "display_name").addSelect("preference.avatarFile", "avatar_file").where("member.conversationId IN (:...ids)", { ids }).orderBy("member.joinedAt", "ASC").getRawMany(),
			this.messageQuery().distinctOn(["m.conversationId"]).where("m.conversationId IN (:...ids)", { ids }).orderBy("m.conversationId", "ASC").addOrderBy("m.sequence", "DESC").getRawMany<MessageRow>(),
			this.dataSource.getRepository(ChatMessageEntity).createQueryBuilder("message").innerJoin(ChatMemberEntity, "member", "member.conversationId = message.conversationId AND member.userId = :userId", { userId }).select("message.conversationId", "conversation_id").addSelect("COUNT(*)::int", "n").where("message.conversationId IN (:...ids)", { ids }).andWhere("message.kind = 'text'").andWhere("message.createdAt > member.lastReadAt").andWhere("message.userId IS DISTINCT FROM :userId", { userId }).groupBy("message.conversationId").getRawMany(),
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
