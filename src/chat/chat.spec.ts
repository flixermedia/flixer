import { describe, expect, it, vi } from "vitest";
import { generateKeyPairSync, sign as signBytes } from "node:crypto";
import type { DataSource } from "typeorm";
import type { NotificationService } from "../api/notifications/notificationService.js";
import { ChatMember as ChatMemberEntity, ChatMessage as ChatMessageEntity } from "../entities/chat.entity.js";
import { ChatConversation as ChatConversationEntity } from "../entities/chatConversation.entity.js";
import { ChatMlsDevice, ChatMlsHistoryBackup, ChatMlsKeyPackage, ChatMlsWelcome } from "../entities/chatMls.entity.js";
import { IssueReport } from "../entities/issueReport.entity.js";
import { Notification } from "../entities/notification.entity.js";
import { Setting } from "../entities/setting.entity.js";
import { User } from "../entities/user.entity.js";
import { UserPreference } from "../entities/userPreference.entity.js";
import { SendMessageRequest } from "./chatRequests.js";
import { ChatService, cleanMessage, cleanName, directKey, MAX_MESSAGE_LENGTH } from "./chatService.js";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const CONVERSATION = "33333333-3333-4333-8333-333333333333";

type MockQuery = (sql: string, parameters?: unknown[]) => Promise<unknown[]>;

interface EntityOptions {
	select?: Record<string, boolean>;
	where?: Record<string, unknown>;
}

/** Canned answers for repository reads; anything not answered is empty (no rows, no match). */
interface EntityReads {
	find?: (entity: unknown, options: EntityOptions) => unknown[];
	findOne?: (entity: unknown, options: EntityOptions) => unknown;
	exists?: (entity: unknown, options: EntityOptions) => boolean;
}

/** Raw `query` stays a mock for the statements still written as SQL; repository calls land on `em`, keyed by entity. */
function mockDataSource(query: MockQuery, reads: EntityReads = {}) {

	const builders: Array<{ entity: unknown; alias?: string; builder: object }> = [];
	const em = {
		find: vi.fn(async (entity: unknown, options: EntityOptions) => reads.find?.(entity, options) ?? (entity === Setting ? query("SELECT value FROM settings") : [])),
		findOne: vi.fn(async (entity: unknown, options: EntityOptions) => reads.findOne?.(entity, options) ?? (entity === Setting ? ((await query("SELECT value FROM settings"))[0] ?? null) : null)),
		exists: vi.fn(async (entity: unknown, options: EntityOptions) => reads.exists?.(entity, options) ?? false),
		insert: vi.fn(async (_entity: unknown, _values: unknown) => ({})),
		update: vi.fn(async (_entity: unknown, _criteria: unknown, _values: unknown) => ({ affected: 1 })),
		upsert: vi.fn(async (_entity: unknown, _values: unknown, _conflictPaths: unknown) => ({ identifiers: [] })),
		delete: vi.fn(async (_entity: unknown, _criteria: unknown) => ({ affected: 1 })),
	};
	const createBuilder = (initialEntity?: unknown, initialAlias?: string) => {
		let entity = initialEntity;
		let selected = "";
		let joins: unknown[] = [];
		let action = "";
		const sql = () => {
			const joinNames = joins.map((join) => (typeof join === "string" ? join : (join as { name?: string })?.name));
			if (entity === ChatConversationEntity && selected.includes("encryptionMode")) return "SELECT c.encryption_mode FROM chat_conversations c JOIN chat_members m";
			if (entity === ChatConversationEntity && joinNames.includes("ChatMember")) return "SELECT c.kind, m.role FROM chat_conversations c JOIN chat_members m";
			if (entity === ChatConversationEntity) return "SELECT c.id, c.kind, c.name, c.encryption_mode";
			if (entity === ChatMemberEntity && joinNames.includes("User")) return selected.includes("member.userId") ? "SELECT m.user_id FROM chat_members m JOIN users u" : "FROM chat_members m JOIN users u";
			if (entity === ChatMemberEntity && joinNames.includes("ChatMlsDevice")) return "JOIN chat_mls_devices d ON d.user_id = m.user_id AND d.status = 'active'";
			if (entity === ChatMessageEntity) return "SELECT m.id, m.sequence, m.conversation_id, m.kind, m.encrypted, m.body, m.created_at FROM chat_messages m";
			if (entity === IssueReport) return "FROM issue_reports r";
			if (entity === ChatMlsDevice && joins.includes(ChatMlsDevice)) return "JOIN chat_mls_devices approver";
			if (entity === ChatMlsDevice) return "SELECT user_id, status, pairing_public_key, approval_challenge FROM chat_mls_devices";
			if (entity === ChatMlsKeyPackage) return action === "update" ? "UPDATE chat_mls_key_packages" : "FROM chat_mls_key_packages";
			if (entity === User) return "FROM users u LEFT JOIN user_preferences up";
			if (action === "insert" && entity === ChatMemberEntity) return "INSERT INTO chat_members";
			if (action === "update" && entity === ChatMlsKeyPackage) return "UPDATE chat_mls_key_packages";
			return `QUERY ${initialAlias ?? ""}`;
		};
		const builder = {
			innerJoin: vi.fn((target: unknown) => {
				joins.push(target);
				return builder;
			}),
			leftJoin: vi.fn((target: unknown) => {
				joins.push(target);
				return builder;
			}),
			select: vi.fn((selection: unknown) => {
				selected = Array.isArray(selection) ? selection.join(" ") : String(selection);
				return builder;
			}),
			addSelect: vi.fn(() => builder),
			where: vi.fn(() => builder),
			andWhere: vi.fn(() => builder),
			orWhere: vi.fn(() => builder),
			orderBy: vi.fn(() => builder),
			addOrderBy: vi.fn(() => builder),
			groupBy: vi.fn(() => builder),
			distinctOn: vi.fn(() => builder),
			skip: vi.fn(() => builder),
			take: vi.fn(() => builder),
			offset: vi.fn(() => builder),
			limit: vi.fn(() => builder),
			setLock: vi.fn(() => builder),
			setOnLocked: vi.fn(() => builder),
			setParameter: vi.fn(() => builder),
			setParameters: vi.fn(() => builder),
			set: vi.fn(() => builder),
			update: vi.fn((target: unknown) => {
				action = "update";
				entity = target;
				return builder;
			}),
			insert: vi.fn(() => {
				action = "insert";
				return builder;
			}),
			delete: vi.fn(() => {
				action = "delete";
				return builder;
			}),
			into: vi.fn((target: unknown) => {
				entity = target;
				return builder;
			}),
			from: vi.fn((target: unknown) => {
				entity = target;
				return builder;
			}),
			values: vi.fn(() => builder),
			valuesFromSelect: vi.fn(() => builder),
			orIgnore: vi.fn(() => builder),
			returning: vi.fn(() => builder),
			getRawOne: vi.fn(async () => (await query(sql()))[0] ?? null),
			getRawMany: vi.fn(async () => query(sql())),
			getOne: vi.fn(async () => {
				const row = (await query(sql()))[0] as Record<string, unknown> | undefined;
				return entity === ChatConversationEntity && row ? { encryptionMode: row.encryptionMode ?? row.encryption_mode } : (row ?? null);
			}),
			getMany: vi.fn(async () => query(sql())),
			getCount: vi.fn(async () => 0),
			getRawAndEntities: vi.fn(async () => ({ raw: await query(sql()), entities: [] })),
			execute: vi.fn(async () => {
				const result = await query(sql());
				const raw = Array.isArray(result[0]) ? result[0] : result;
				const affected = typeof result[1] === "number" ? result[1] : raw.length;
				return { raw, affected };
			}),
		};
		builders.push({ entity, alias: initialAlias, builder });
		return builder;
	};
	const getRepository = (entity: unknown) => ({
		find: (options: EntityOptions) => em.find(entity, options),
		findBy: (where: Record<string, unknown>) => em.find(entity, { where }),
		findOne: (options: EntityOptions) => em.findOne(entity, options),
		exists: (options: EntityOptions) => em.exists(entity, options),
		insert: (values: unknown) => em.insert(entity, values),
		update: (criteria: unknown, values: unknown) => em.update(entity, criteria, values),
		upsert: (values: unknown, conflictPaths: unknown) => em.upsert(entity, values, conflictPaths),
		delete: (criteria: unknown) => em.delete(entity, criteria),
		createQueryBuilder: (alias?: string) => createBuilder(entity, alias),
	});
	const manager = { query, getRepository, findOne: em.findOne, insert: em.insert, update: em.update, createQueryBuilder: (entity?: unknown, alias?: string) => createBuilder(entity, alias) };
	const dataSource = {
		query,
		getRepository,
		createQueryBuilder: (entity?: unknown, alias?: string) => createBuilder(entity, alias),
		transaction: async <T>(work: (manager: unknown) => Promise<T>) => work(manager),
	} as unknown as DataSource;
	return Object.assign(dataSource, { em, builders });

}

function service(encryptionEnabled = false) {

	const send = vi.fn(async () => ({ recipients: 1, pushed: 0 }));
	const query = vi.fn(async (sql: string): Promise<unknown[]> => {
		if (sql.includes("SELECT value FROM settings")) {
			return [{ value: encryptionEnabled }];
		}
		if (sql.includes("FROM chat_conversations c JOIN chat_members m")) {
			return [{ kind: "direct", role: "member" }];
		}
		if (sql.includes("FROM chat_messages m")) {
			return [{ id: "m1", conversation_id: CONVERSATION, kind: "text", encrypted: encryptionEnabled, body: "hi", created_at: new Date(), username: "ann", display_name: "Ann", avatar_file: null }];
		}
		if (sql.includes("SELECT m.user_id FROM chat_members")) {
			return [{ user_id: B }];
		}
		return [];
	});
	const dataSource = mockDataSource(query, {
		find: (entity) => (entity === ChatMemberEntity ? [{ userId: B }] : []),
		findOne: (entity) => (entity === ChatConversationEntity ? { kind: "direct", name: null, encryptionMode: encryptionEnabled ? "encrypted" : "plaintext" } : null),
		exists: (entity) => entity === ChatMlsDevice && encryptionEnabled,
	});
	const chat = new ChatService(dataSource, { send } as unknown as NotificationService);
	return { chat, query, send, em: dataSource.em };

}

describe("chat helpers", () => {
	it("loads chat request DTOs with their nested Welcome schema initialized", () => {
		expect(new SendMessageRequest()).toBeInstanceOf(SendMessageRequest);
	});

	it("builds the same direct key for either order", () => {
		expect(directKey(A, B)).toBe(directKey(B, A));
	});

	it("trims messages and rejects empty or oversized ones", () => {
		expect(cleanMessage("  hello  ")).toBe("hello");
		expect(() => cleanMessage("   ")).toThrow();
		expect(() => cleanMessage("x".repeat(MAX_MESSAGE_LENGTH + 1))).toThrow();
	});

	it("accepts bounded base64 MLS envelopes only", async () => {
		const { chat } = service(true);
		await expect(chat.send(A, CONVERSATION, "AAAA", true, undefined, "44444444-4444-4444-8444-444444444444")).resolves.toMatchObject({ body: "hi", encrypted: true });
		await expect(chat.send(A, CONVERSATION, "not base64", true)).rejects.toThrow(/valid base64/i);
	});

	it("requires an active sending device for encrypted messages", async () => {
		const { chat } = service(true);
		await expect(chat.send(A, CONVERSATION, "AAAA", true)).rejects.toThrow(/sending device ID/i);
	});

	it("rejects encrypted messages from revoked or unknown devices", async () => {
		const query = vi.fn(async (sql: string): Promise<unknown[]> => {
			if (sql.includes("FROM chat_conversations c JOIN chat_members m")) return [{ kind: "direct", role: "member" }];
			return [];
		});
		const chat = new ChatService(mockDataSource(query, { findOne: (entity) => (entity === ChatConversationEntity ? { encryptionMode: "encrypted" } : null) }), {} as NotificationService);

		await expect(chat.send(A, CONVERSATION, "AAAA", true, undefined, "44444444-4444-4444-8444-444444444444")).rejects.toThrow(/device is not active/i);
	});

	it("requires a Welcome for every other active chat device", async () => {
		const query = vi.fn(async (sql: string): Promise<unknown[]> => {
			if (sql.includes("FROM chat_conversations c JOIN chat_members m")) return [{ kind: "direct", role: "member" }];
			if (sql.includes("JOIN chat_mls_devices d ON d.user_id = m.user_id AND d.status = 'active'")) return [{ device_id: "55555555-5555-4555-8555-555555555555" }];
			return [];
		});
		const chat = new ChatService(
			mockDataSource(query, {
				findOne: (entity) => (entity === ChatConversationEntity ? { encryptionMode: "encrypted" } : null),
				exists: (entity) => entity === ChatMlsDevice,
			}),
			{} as NotificationService,
		);

		await expect(chat.send(A, CONVERSATION, "AAAA", true, undefined, "44444444-4444-4444-8444-444444444444")).rejects.toThrow(/Welcome for every other active chat device/i);
	});

	it("rejects plaintext without storing it in an encrypted conversation", async () => {
		const { chat, em } = service(true);

		await expect(chat.send(A, CONVERSATION, "plaintext")).rejects.toThrow(/requires end-to-end encrypted messages/i);
		expect(em.insert).not.toHaveBeenCalled();
	});

	it("allows an authorized member to downgrade an encrypted conversation", async () => {
		const query = vi.fn(async (sql: string): Promise<unknown[]> => {
			if (sql.includes("SELECT c.encryption_mode")) return [{ encryption_mode: "encrypted" }];
			if (sql.includes("SELECT value FROM settings")) return [{ value: true }];
			return [];
		});
		const dataSource = mockDataSource(query, { find: (entity) => (entity === ChatMemberEntity ? [{ userId: B }] : []) });
		const chat = new ChatService(dataSource, {} as NotificationService);
		const conversation = {
			id: CONVERSATION,
			kind: "direct" as const,
			encryptionMode: "plaintext" as const,
			name: null,
			supportChatOpen: null,
			members: [],
			lastMessage: null,
			unread: 0,
			updatedAt: new Date().toISOString(),
		};
		vi.spyOn(chat, "conversation").mockResolvedValue(conversation);
		const listener = vi.fn();
		chat.onEvent(listener);

		await expect(chat.downgradeToPlaintext(A, CONVERSATION)).resolves.toEqual(conversation);
		expect(dataSource.em.update).toHaveBeenCalledWith(ChatConversationEntity, { id: CONVERSATION }, { encryptionMode: "plaintext" });
		expect(dataSource.em.insert).toHaveBeenCalledWith(ChatMessageEntity, expect.objectContaining({ conversationId: CONVERSATION, userId: A, kind: "system", encrypted: false, body: expect.stringContaining("Future messages are readable by the server.") }));
		expect(listener).toHaveBeenCalledWith([B], { type: "changed", conversationId: CONVERSATION });
	});

	it("allows a conversation member to switch back to encrypted messages", async () => {
		const query = vi.fn(async (sql: string): Promise<unknown[]> => {
			if (sql.includes("SELECT c.encryption_mode")) return [{ encryption_mode: "plaintext" }];
			return [];
		});
		const dataSource = mockDataSource(query, { find: (entity) => (entity === ChatMemberEntity ? [{ userId: B }] : []) });
		const chat = new ChatService(dataSource, {} as NotificationService);
		const conversation = {
			id: CONVERSATION,
			kind: "direct" as const,
			encryptionMode: "encrypted" as const,
			name: null,
			supportChatOpen: null,
			members: [],
			lastMessage: null,
			unread: 0,
			updatedAt: new Date().toISOString(),
		};
		vi.spyOn(chat, "conversation").mockResolvedValue(conversation);
		const listener = vi.fn();
		chat.onEvent(listener);

		await expect(chat.upgradeToEncrypted(A, CONVERSATION)).resolves.toEqual(conversation);
		expect(dataSource.em.update).toHaveBeenCalledWith(ChatConversationEntity, { id: CONVERSATION }, { encryptionMode: "encrypted" });
		expect(dataSource.em.insert).toHaveBeenCalledWith(ChatMessageEntity, expect.objectContaining({ conversationId: CONVERSATION, userId: A, kind: "system", encrypted: false, body: expect.stringContaining("Earlier plaintext messages remain readable by the server.") }));
		expect(listener).toHaveBeenCalledWith([B], { type: "changed", conversationId: CONVERSATION });
	});

	it("rejects a downgrade when the administrator has disabled it", async () => {
		const query = vi.fn(async (sql: string): Promise<unknown[]> => (sql.includes("SELECT c.encryption_mode") ? [{ encryption_mode: "encrypted" }] : sql.includes("SELECT value FROM settings") ? [{ value: false }] : []));
		const dataSource = mockDataSource(query);
		const chat = new ChatService(dataSource, {} as NotificationService);

		await expect(chat.downgradeToPlaintext(A, CONVERSATION)).rejects.toThrow(/administrator has not enabled/i);
		expect(dataSource.em.update).not.toHaveBeenCalled();
	});

	it("reports whether members are allowed to downgrade", async () => {
		const query = vi.fn(async () => []);
		const chat = new ChatService(
			mockDataSource(query, {
				find: (entity) =>
					entity === Setting
						? [
								{ key: "chat_e2ee_enabled", value: true },
								{ key: "chat_user_downgrade_enabled", value: true },
							]
						: [],
			}),
			{} as NotificationService,
		);

		await expect(chat.encryptionStatus()).resolves.toEqual({
			enabled: true,
			supported: true,
			allowUserDowngrade: true,
		});
	});

	it("does not allow a non-member to downgrade a conversation", async () => {
		const query = vi.fn(async (): Promise<unknown[]> => []);
		const chat = new ChatService(mockDataSource(query), {} as NotificationService);

		await expect(chat.downgradeToPlaintext(A, CONVERSATION)).rejects.toThrow(/conversation not found/i);
	});

	it("does not include message bodies in realtime events", async () => {
		const { chat } = service();
		const listener = vi.fn();
		chat.onEvent(listener);

		await chat.send(A, CONVERSATION, "hello");

		expect(listener).toHaveBeenCalledWith([B], { type: "changed", conversationId: CONVERSATION });
	});

	it("pages chat history by the stable MLS message sequence", async () => {
		const query = vi.fn(async (sql: string): Promise<unknown[]> => {
			if (sql.includes("FROM chat_conversations c JOIN chat_members m")) return [{ kind: "direct", role: "member" }];
			if (sql.includes("FROM chat_messages m")) {
				return [{ id: "m2", sequence: "2", conversation_id: CONVERSATION, kind: "text", body: "next", created_at: new Date(), username: "ann", display_name: "Ann", avatar_file: null }];
			}
			return [];
		});
		const dataSource = mockDataSource(query);
		const chat = new ChatService(dataSource, {} as NotificationService);

		await chat.messages(A, CONVERSATION, { afterSequence: "1" });

		const messageBuilder = dataSource.builders.find(({ entity }) => entity === ChatMessageEntity)?.builder as { andWhere: ReturnType<typeof vi.fn> };
		expect(messageBuilder.andWhere).toHaveBeenCalledWith("m.sequence > CAST(:afterSequence AS bigint)", { afterSequence: "1" });
	});

	it("rejects message cursors outside the database sequence range", async () => {
		const query = vi.fn(async (sql: string): Promise<unknown[]> => {
			if (sql.includes("FROM chat_conversations c JOIN chat_members m")) return [{ kind: "direct", role: "member" }];
			return [];
		});
		const chat = new ChatService(mockDataSource(query), {} as NotificationService);

		await expect(chat.messages(A, CONVERSATION, { afterSequence: "9223372036854775808" })).rejects.toThrow(/cursor isn't valid/i);
	});

	it("collapses group name whitespace and enforces the length", () => {
		expect(cleanName("  Movie   night ")).toBe("Movie night");
		expect(() => cleanName("")).toThrow();
		expect(() => cleanName("x".repeat(61))).toThrow();
	});
});

describe("ChatService", () => {
	it("activates every newly registered device without another-device approval", async () => {
		const { publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
		const pairingPublicKey = publicKey.export({ format: "der", type: "spki" }).toString("base64");
		const query = vi.fn(async (sql: string): Promise<unknown[]> => {
			return [];
		});
		const dataSource = mockDataSource(query);
		const chat = new ChatService(dataSource, {} as NotificationService);

		await expect(chat.registerMlsDevice(A, "44444444-4444-4444-8444-444444444444", "Browser", "AAAA", pairingPublicKey)).resolves.toMatchObject({
			status: "active",
			approvalChallenge: null,
		});
		expect(dataSource.em.insert).toHaveBeenCalledWith(ChatMlsDevice, expect.objectContaining({ id: "44444444-4444-4444-8444-444444444444", userId: A, name: "Browser", status: "active", pairingPublicKey, approvedAt: expect.any(Function) }));
		expect(dataSource.em.insert).toHaveBeenCalledWith(ChatMlsKeyPackage, { id: expect.any(String), deviceId: "44444444-4444-4444-8444-444444444444", keyPackage: "AAAA" });
	});

	it("activates a previously pending device and repairs its pairing key on registration", async () => {
		const { publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
		const pairingPublicKey = publicKey.export({ format: "der", type: "spki" }).toString("base64");
		const query = vi.fn(async (sql: string): Promise<unknown[]> => {
			if (sql.includes("SELECT user_id, status, pairing_public_key, approval_challenge")) {
				return [{ user_id: A, status: "pending", pairing_public_key: null, approval_challenge: "challenge" }];
			}
			return [];
		});
		const dataSource = mockDataSource(query);
		const chat = new ChatService(dataSource, {} as NotificationService);

		await expect(chat.registerMlsDevice(A, "44444444-4444-4444-8444-444444444444", "Browser", "AAAA", pairingPublicKey)).resolves.toMatchObject({ status: "active" });
		expect(dataSource.em.update).toHaveBeenCalledWith(ChatMlsDevice, { id: "44444444-4444-4444-8444-444444444444" }, expect.objectContaining({ name: "Browser", status: "active", approvalChallenge: null, pairingPublicKey, approvedAt: expect.any(Function) }));
	});

	it("stores only the user's opaque encrypted chat history backup", async () => {
		const query = vi.fn(async () => []);
		const dataSource = mockDataSource(query);
		const chat = new ChatService(dataSource, {} as NotificationService);

		await chat.saveChatHistoryBackup(A, "encrypted-envelope");
		expect(dataSource.em.upsert).toHaveBeenCalledWith(ChatMlsHistoryBackup, { userId: A, backup: "encrypted-envelope", updatedAt: expect.any(Function) }, ["userId"]);
		await expect(chat.saveChatHistoryBackup(A, "")).rejects.toThrow(/backup is invalid/i);
	});

	it("approves a new device only with a signature from an active device", async () => {
		const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
		const targetDeviceId = "44444444-4444-4444-8444-444444444444";
		const challenge = "approval-challenge";
		const payload = Buffer.from(`flixer-chat-device-approval:v1:${targetDeviceId}:${challenge}`);
		const pairingPublicKey = publicKey.export({ format: "der", type: "spki" }).toString("base64");
		const signature = signBytes("sha256", payload, { key: privateKey, dsaEncoding: "ieee-p1363" }).toString("base64");
		const query = vi.fn(async (sql: string): Promise<unknown[]> => {
			if (sql.includes("JOIN chat_mls_devices approver")) return [{ approval_challenge: challenge, pairing_public_key: pairingPublicKey }];
			return [];
		});

		const dataSource = mockDataSource(query);
		const chat = new ChatService(dataSource, {} as NotificationService);

		await expect(chat.approveMlsDevice(A, "55555555-5555-4555-8555-555555555555", targetDeviceId, signature)).resolves.toBeUndefined();
		expect(dataSource.em.update).toHaveBeenCalledWith(ChatMlsDevice, { id: targetDeviceId }, { status: "active", approvedAt: expect.any(Function), approvalChallenge: null });
		await expect(chat.approveMlsDevice(A, "55555555-5555-4555-8555-555555555555", targetDeviceId, "AAAA")).rejects.toThrow(/trusted device/i);
	});

	it("revokes only devices belonging to the authenticated user", async () => {
		const query = vi.fn(async (sql: string): Promise<unknown[]> => {
			if (sql.includes("UPDATE chat_mls_devices")) return [[{ id: "44444444-4444-4444-8444-444444444444" }], 1];
			return [];
		});
		const dataSource = mockDataSource(query);
		const chat = new ChatService(dataSource, {} as NotificationService);

		await expect(chat.revokeMlsDevice(A, "44444444-4444-4444-8444-444444444444")).resolves.toBeUndefined();
		expect(dataSource.em.update).toHaveBeenCalledWith(ChatMlsDevice, { id: "44444444-4444-4444-8444-444444444444", userId: A, status: expect.any(Object) }, { status: "revoked", revokedAt: expect.any(Function) });
		expect(dataSource.em.update).toHaveBeenCalledWith(ChatMlsKeyPackage, { deviceId: "44444444-4444-4444-8444-444444444444" }, { usedAt: expect.any(Function) });
	});

	it("claims an MLS key package once for a conversation member", async () => {
		let claimed = false;
		const query = vi.fn(async (sql: string): Promise<unknown[]> => {
			if (sql.includes("FROM chat_conversations c JOIN chat_members m")) return [{ kind: "direct", role: "member" }];
			if (sql.includes("FROM chat_mls_key_packages")) return [{ user_id: B, device_id: "55555555-5555-4555-8555-555555555555", key_package_id: "66666666-6666-4666-8666-666666666666", key_package: "AAAA" }];
			if (sql.includes("UPDATE chat_mls_key_packages")) {
				if (claimed) return [[], 0];
				claimed = true;
				return [[{ user_id: B, device_id: "55555555-5555-4555-8555-555555555555", key_package_id: "66666666-6666-4666-8666-666666666666", key_package: "AAAA" }], 1];
			}
			return [];
		});
		const chat = new ChatService(mockDataSource(query), {} as NotificationService);

		await expect(chat.claimMlsKeyPackage(A, CONVERSATION, "66666666-6666-4666-8666-666666666666")).resolves.toMatchObject({
			keyPackage: "AAAA",
			available: false,
		});
		await expect(chat.claimMlsKeyPackage(A, CONVERSATION, "66666666-6666-4666-8666-666666666666")).rejects.toThrow(/already used/i);
	});

	it("stores a message and sends a generic notification with the thread link", async () => {
		const { chat, send } = service();
		const message = await chat.send(A, CONVERSATION, "hi");
		expect(message.body).toBe("hi");
		expect(send).toHaveBeenCalledWith(expect.objectContaining({ kind: "message", url: `/chat/${CONVERSATION}`, body: "You have a new chat message." }), [B]);
	});

	it("limits how fast someone can send", async () => {
		const { chat } = service();
		for (let i = 0; i < 10; i++) {
			await chat.send(A, CONVERSATION, `m${i}`);
		}
		await expect(chat.send(A, CONVERSATION, "one more")).rejects.toThrow(/too quickly/);
	});

	it("prevents sending messages to a closed issue support chat", async () => {
		const query = vi.fn(async (sql: string): Promise<unknown[]> => {
			if (sql.includes("FROM chat_conversations c JOIN chat_members m")) return [{ kind: "group", role: "owner" }];
			if (sql.includes("FROM issue_reports r")) {
				return [{ id: "issue-report", user_id: B, chat_open: false, chat_enabled: true }];
			}
			return [];
		});
		const chat = new ChatService(mockDataSource(query), {} as NotificationService);

		await expect(chat.send(A, CONVERSATION, "Can you help?")).rejects.toThrow(/chat is closed/i);
		expect(query).toHaveBeenCalledTimes(2);
	});

	it("allows an issue support group member to delete the conversation", async () => {
		const query = vi.fn(async (sql: string): Promise<unknown[]> => {
			if (sql.includes("FROM chat_conversations c JOIN chat_members m")) return [{ kind: "group", role: "member" }];
			return [];
		});
		const dataSource = mockDataSource(query, {
			find: (entity) => (entity === IssueReport ? [{ id: "issue-report" }] : entity === ChatMemberEntity ? [{ userId: B }, { userId: A }] : []),
		});
		const chat = new ChatService(dataSource, {} as NotificationService);

		await expect(chat.deleteConversation(A, CONVERSATION)).resolves.toBeUndefined();
		expect(dataSource.em.update).toHaveBeenCalledWith(IssueReport, { conversationId: CONVERSATION }, { conversationId: null, chatOpen: false, updatedAt: expect.any(Function) });
		expect(dataSource.em.delete).toHaveBeenCalledWith(ChatConversationEntity, { id: CONVERSATION });
	});

	it("lets an issue requester leave without deleting the conversation", async () => {
		const query = vi.fn(async (sql: string): Promise<unknown[]> => {
			if (sql.includes("SELECT value FROM settings")) return [{ value: false }];
			if (sql.includes("FROM chat_conversations c JOIN chat_members m")) return [{ kind: "group", role: "member" }];
			if (sql.includes("FROM chat_members m JOIN users")) return [{ id: B, username: "requester", display_name: "Requester", role: "member" }];
			return [];
		});
		const dataSource = mockDataSource(query, {
			find: (entity, options) => (entity === ChatMemberEntity ? (options.select?.role ? [{ userId: A, role: "owner" }] : [{ userId: A }]) : []),
		});
		const chat = new ChatService(dataSource, {} as NotificationService);

		await expect(chat.removeMember(B, CONVERSATION, "requester")).resolves.toBeUndefined();
		expect(dataSource.em.delete).toHaveBeenCalledWith(ChatMemberEntity, { conversationId: CONVERSATION, userId: B });
		expect(dataSource.em.delete).not.toHaveBeenCalledWith(ChatConversationEntity, { id: CONVERSATION });
	});

	it("closes a support chat when the last member leaves", async () => {
		const query = vi.fn(async (sql: string): Promise<unknown[]> => {
			if (sql.includes("FROM chat_conversations c JOIN chat_members m")) return [{ kind: "group", role: "member" }];
			if (sql.includes("FROM chat_members m JOIN users")) return [{ id: B, username: "requester", display_name: "Requester", role: "member" }];
			return [];
		});
		const dataSource = mockDataSource(query, {
			find: (entity, options) => (entity === ChatMemberEntity ? (options.select?.role ? [] : [{ userId: B }]) : []),
		});
		const chat = new ChatService(dataSource, {} as NotificationService);

		await chat.removeMember(B, CONVERSATION, "requester");

		expect(dataSource.em.update).toHaveBeenCalledWith(IssueReport, { conversationId: CONVERSATION }, { conversationId: null, chatOpen: false, updatedAt: expect.any(Function) });
		expect(dataSource.em.delete).toHaveBeenCalledWith(ChatConversationEntity, { id: CONVERSATION });
	});

	it("re-adds a departed issue requester before the next support message", async () => {
		const insertCalls: Array<[string, unknown[]]> = [];
		const send = vi.fn(async () => ({ recipients: 1, pushed: 1 }));
		const query = vi.fn(async (sql: string, params: unknown[] = []): Promise<unknown[]> => {
			if (sql.includes("SELECT value FROM settings")) return [{ value: false }];
			if (sql.includes("SELECT encryption_mode FROM chat_conversations")) return [{ encryption_mode: "plaintext" }];
			if (sql.includes("FROM chat_conversations c JOIN chat_members m")) return [{ kind: "group", role: "owner" }];
			if (sql.includes("FROM issue_reports r")) {
				return [{ id: "issue-report", user_id: B, chat_open: true, chat_enabled: true }];
			}
			if (sql.includes("INSERT INTO chat_members")) {
				insertCalls.push([sql, params]);
				return [{ user_id: B }];
			}
			if (sql.includes("SELECT m.id, m.sequence, m.conversation_id")) {
				return [{ id: "new-message", sequence: "10", conversation_id: CONVERSATION, kind: "text", body: "Update", created_at: new Date(), username: "admin", display_name: "Admin", avatar_file: null }];
			}
			if (sql.includes("SELECT m.user_id FROM chat_members")) return [{ user_id: B }];
			return [];
		});
		const dataSource = mockDataSource(query, {
			find: (entity) => (entity === ChatMemberEntity ? [{ userId: A }, { userId: B }] : []),
			findOne: (entity) => (entity === ChatConversationEntity ? { kind: "group", name: "Issue: Playback" } : null),
		});
		const chat = new ChatService(dataSource, { send } as unknown as NotificationService);

		await chat.send(A, CONVERSATION, "Update");

		expect(insertCalls).toHaveLength(1);
		expect(insertCalls[0][0]).toBe("INSERT INTO chat_members");
		const rejoinIndex = query.mock.calls.findIndex(([sql]) => sql.includes("INSERT INTO chat_members"));
		const messageIndex = dataSource.em.insert.mock.calls.findIndex(([entity, values]) => entity === ChatMessageEntity && (values as { kind: string }).kind === "text");
		expect(messageIndex).toBeGreaterThanOrEqual(0);
		expect(dataSource.em.insert.mock.invocationCallOrder[messageIndex]).toBeGreaterThan(query.mock.invocationCallOrder[rejoinIndex]);
		expect(send).toHaveBeenCalledWith(expect.objectContaining({ url: `/chat/${CONVERSATION}` }), [B]);
		expect(query).not.toHaveBeenCalledWith(expect.stringContaining("DELETE FROM chat_messages"), expect.anything());
		expect(dataSource.em.delete).not.toHaveBeenCalledWith(ChatMessageEntity, expect.anything());
		expect(dataSource.em.delete).toHaveBeenCalledWith(Notification, expect.objectContaining({ kind: "message", url: `/chat/${CONVERSATION}` }));
	});

	it("creates an issue support chat when the administrator is also the requester", async () => {
		const inserts: Array<[unknown, unknown]> = [];
		const manager = {
			query: vi.fn(async (sql: string) => (sql.includes("SELECT value FROM settings") ? [{ value: false }] : [])),
			findOne: async () => ({ value: false }),
			getRepository: (entity: unknown) => ({
				insert: async (values: unknown) => void inserts.push([entity, values]),
				update: async () => ({ affected: 1 }),
			}),
		};
		const query = vi.fn(async (sql: string): Promise<unknown[]> => {
			if (sql.includes("SELECT c.kind, m.role FROM chat_conversations")) return [{ kind: "group", role: "owner" }];
			if (sql.includes("SELECT c.id, c.kind, c.name, c.encryption_mode")) {
				return [{ id: CONVERSATION, kind: "group", name: "Issue: Playback", encryption_mode: "plaintext", last_message_at: new Date(), support_chat_open: true }];
			}
			if (sql.includes("SELECT m.conversation_id, m.role")) {
				return [{ conversation_id: CONVERSATION, id: A, username: "admin", display_name: "Admin", avatar_file: null, role: "owner" }];
			}
			return [];
		});
		const dataSource = {
			query,
			getRepository: () => ({ find: async () => [{ userId: A }] }),
			transaction: vi.fn(async (work: (transactionManager: typeof manager) => Promise<unknown>) => work(manager)),
		} as unknown as DataSource;
		const chat = new ChatService(dataSource, {} as NotificationService);
		vi.spyOn(chat, "conversation").mockResolvedValue({ id: CONVERSATION, kind: "group", encryptionMode: "plaintext", name: "Issue: Playback", supportChatOpen: true, members: [], lastMessage: null, unread: 0, updatedAt: new Date().toISOString() });

		await chat.createSupportGroup(A, A, "Issue: Playback");

		const memberInserts = inserts.filter(([entity]) => entity === ChatMemberEntity);
		expect(memberInserts).toHaveLength(1);
		expect(memberInserts[0][1]).toEqual({ conversationId: expect.any(String), userId: A, role: "owner" });
		const conversationInsert = inserts.find(([entity]) => entity === ChatConversationEntity);
		expect(conversationInsert?.[1]).toEqual({ id: expect.any(String), kind: "group", name: "Issue: Playback", createdBy: A, encryptionMode: "plaintext" });
	});

	it("returns the current open state for support conversations", async () => {
		const query = vi.fn(async (sql: string): Promise<unknown[]> => {
			if (sql.includes("FROM chat_conversations c JOIN chat_members m")) return [{ kind: "group", role: "owner" }];
			if (sql.includes("SELECT c.id, c.kind, c.name, c.encryption_mode")) {
				return [{ id: CONVERSATION, kind: "group", name: "Issue: Playback", encryption_mode: "plaintext", last_message_at: new Date(), support_chat_open: false }];
			}
			if (sql.includes("SELECT m.conversation_id, m.role")) {
				return [{ conversation_id: CONVERSATION, id: A, username: "admin", display_name: "Admin", avatar_file: null, role: "owner" }];
			}
			return [];
		});
		const chat = new ChatService(mockDataSource(query), {} as NotificationService);

		await expect(chat.conversation(A, CONVERSATION)).resolves.toMatchObject({
			encryptionMode: "plaintext",
			supportChatOpen: false,
		});
	});

	it("notifies support chat members when its state changes", async () => {
		const { chat, em } = service();
		const listener = vi.fn();
		chat.onEvent(listener);

		await chat.supportChatChanged(CONVERSATION);

		expect(em.find).toHaveBeenCalledWith(ChatMemberEntity, { select: { userId: true }, where: { conversationId: CONVERSATION } });
		expect(listener).toHaveBeenCalledWith([B], { type: "changed", conversationId: CONVERSATION });
	});
});
