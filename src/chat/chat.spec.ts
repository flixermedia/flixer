import { describe, expect, it, vi } from "vitest";
import { generateKeyPairSync, sign as signBytes } from "node:crypto";
import type { DataSource } from "typeorm";
import type { NotificationService } from "../api/notifications/notificationService.js";
import { SendMessageRequest } from "./chatRequests.js";
import { ChatService, cleanMessage, cleanName, directKey, MAX_MESSAGE_LENGTH } from "./chatService.js";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const CONVERSATION = "33333333-3333-4333-8333-333333333333";

type MockQuery = (sql: string, parameters?: unknown[]) => Promise<unknown[]>;

function mockDataSource(query: MockQuery): DataSource {
	return {
		query,
		transaction: async <T>(work: (manager: { query: MockQuery }) => Promise<T>) => work({ query }),
	} as unknown as DataSource;
}

function service(encryptionEnabled = false) {

	const send = vi.fn(async () => ({ recipients: 1, pushed: 0 }));
	const query = vi.fn(async (sql: string): Promise<unknown[]> => {
		if (sql.includes("SELECT encryption_mode FROM chat_conversations")) {
			return [{ encryption_mode: encryptionEnabled ? "encrypted" : "plaintext" }];
		}
		if (sql.includes("FROM chat_mls_devices WHERE id = $1 AND user_id = $2 AND status = 'active'")) {
			return encryptionEnabled ? [{ id: "44444444-4444-4444-8444-444444444444" }] : [];
		}
		if (sql.includes("FROM chat_conversations c JOIN chat_members m")) {
			return [{ kind: "direct", role: "member" }];
		}
		if (sql.includes("FROM chat_messages m")) {
			return [{ id: "m1", conversation_id: CONVERSATION, kind: "text", encrypted: encryptionEnabled, body: "hi", created_at: new Date(), username: "ann", display_name: "Ann", avatar_file: null }];
		}
		if (sql.includes("SELECT user_id FROM chat_members") || sql.includes("SELECT m.user_id FROM chat_members")) {
			return [{ user_id: B }];
		}
		if (sql.includes("SELECT kind, name")) {
			return [{ kind: "direct", name: null }];
		}
		return [];
	});
	const chat = new ChatService(mockDataSource(query), { send } as unknown as NotificationService);
	return { chat, query, send };

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
			if (sql.includes("SELECT encryption_mode FROM chat_conversations")) return [{ encryption_mode: "encrypted" }];
			if (sql.includes("FROM chat_conversations c JOIN chat_members m")) return [{ kind: "direct", role: "member" }];
			if (sql.includes("FROM chat_mls_devices WHERE id = $1 AND user_id = $2 AND status = 'active'")) return [];
			return [];
		});
		const chat = new ChatService(mockDataSource(query), {} as NotificationService);

		await expect(chat.send(A, CONVERSATION, "AAAA", true, undefined, "44444444-4444-4444-8444-444444444444")).rejects.toThrow(/device is not active/i);
	});

	it("requires a Welcome for every other active chat device", async () => {
		const query = vi.fn(async (sql: string): Promise<unknown[]> => {
			if (sql.includes("SELECT encryption_mode FROM chat_conversations")) return [{ encryption_mode: "encrypted" }];
			if (sql.includes("FROM chat_conversations c JOIN chat_members m")) return [{ kind: "direct", role: "member" }];
			if (sql.includes("FROM chat_mls_devices WHERE id = $1 AND user_id = $2 AND status = 'active'")) return [{ id: "44444444-4444-4444-8444-444444444444" }];
			if (sql.includes("JOIN chat_mls_devices d ON d.user_id = m.user_id AND d.status = 'active'")) return [{ device_id: "55555555-5555-4555-8555-555555555555" }];
			return [];
		});
		const chat = new ChatService(mockDataSource(query), {} as NotificationService);

		await expect(chat.send(A, CONVERSATION, "AAAA", true, undefined, "44444444-4444-4444-8444-444444444444")).rejects.toThrow(/Welcome for every other active chat device/i);
	});

	it("rejects plaintext without storing it in an encrypted conversation", async () => {
		const { chat, query } = service(true);

		await expect(chat.send(A, CONVERSATION, "plaintext")).rejects.toThrow(/requires end-to-end encrypted messages/i);
		expect(query).not.toHaveBeenCalledWith(
			expect.stringContaining("INSERT INTO chat_messages"),
			expect.anything(),
		);
	});

	it("allows an authorized member to downgrade an encrypted conversation", async () => {
		const query = vi.fn(async (sql: string): Promise<unknown[]> => {
			if (sql.includes("SELECT c.encryption_mode, s.value AS downgrade_enabled")) {
				return [{ encryption_mode: "encrypted", downgrade_enabled: true }];
			}
			if (sql.includes("SELECT user_id FROM chat_members")) return [{ user_id: B }];
			return [];
		});
		const chat = new ChatService(mockDataSource(query), {} as NotificationService);
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
		expect(query).toHaveBeenCalledWith(
			expect.stringContaining("UPDATE chat_conversations SET encryption_mode = $2"),
			[CONVERSATION, "plaintext"],
		);
		expect(query).toHaveBeenCalledWith(
			expect.stringContaining("INSERT INTO chat_messages"),
			expect.arrayContaining([CONVERSATION, A, expect.stringContaining("Future messages are readable by the server.")]),
		);
		expect(listener).toHaveBeenCalledWith([B], { type: "changed", conversationId: CONVERSATION });
	});

	it("allows a conversation member to switch back to encrypted messages", async () => {
		const query = vi.fn(async (sql: string): Promise<unknown[]> => {
			if (sql.includes("SELECT c.encryption_mode")) return [{ encryption_mode: "plaintext" }];
			if (sql.includes("SELECT user_id FROM chat_members")) return [{ user_id: B }];
			return [];
		});
		const chat = new ChatService(mockDataSource(query), {} as NotificationService);
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
		expect(query).toHaveBeenCalledWith(
			expect.stringContaining("UPDATE chat_conversations SET encryption_mode = $2"),
			[CONVERSATION, "encrypted"],
		);
		expect(query).toHaveBeenCalledWith(
			expect.stringContaining("INSERT INTO chat_messages"),
			expect.arrayContaining([CONVERSATION, A, expect.stringContaining("Earlier plaintext messages remain readable by the server.")]),
		);
		expect(listener).toHaveBeenCalledWith([B], { type: "changed", conversationId: CONVERSATION });
	});

	it("rejects a downgrade when the administrator has disabled it", async () => {
		const query = vi.fn(async (sql: string): Promise<unknown[]> => (
			sql.includes("SELECT c.encryption_mode, s.value AS downgrade_enabled")
				? [{ encryption_mode: "encrypted", downgrade_enabled: false }]
				: []
		));
		const chat = new ChatService(mockDataSource(query), {} as NotificationService);

		await expect(chat.downgradeToPlaintext(A, CONVERSATION)).rejects.toThrow(/administrator has not enabled/i);
		expect(query).not.toHaveBeenCalledWith(
			expect.stringContaining("UPDATE chat_conversations"),
			expect.anything(),
		);
	});

	it("reports whether members are allowed to downgrade", async () => {
		const query = vi.fn(async () => [{ enabled: true, allow_user_downgrade: true }]);
		const chat = new ChatService(mockDataSource(query), {} as NotificationService);

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
		const chat = new ChatService(mockDataSource(query), {} as NotificationService);

		await chat.messages(A, CONVERSATION, { afterSequence: "1" });

		expect(query).toHaveBeenCalledWith(expect.stringContaining("m.sequence > $2::bigint"), [CONVERSATION, "1"]);
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
		const chat = new ChatService(mockDataSource(query), {} as NotificationService);

		await expect(chat.registerMlsDevice(A, "44444444-4444-4444-8444-444444444444", "Browser", "AAAA", pairingPublicKey)).resolves.toMatchObject({
			status: "active",
			approvalChallenge: null,
		});
		expect(query).toHaveBeenCalledWith(
			expect.stringContaining("INSERT INTO chat_mls_devices"),
			expect.arrayContaining([A, "Browser", "active", pairingPublicKey, null]),
		);
		expect(query).toHaveBeenCalledWith(
			expect.stringContaining("CASE WHEN $7::boolean THEN now()"),
			["44444444-4444-4444-8444-444444444444", A, "Browser", "active", pairingPublicKey, null, true],
		);
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
		const chat = new ChatService(mockDataSource(query), {} as NotificationService);

		await expect(
			chat.registerMlsDevice(A, "44444444-4444-4444-8444-444444444444", "Browser", "AAAA", pairingPublicKey),
		).resolves.toMatchObject({ status: "active" });
		expect(query).toHaveBeenCalledWith(
			expect.stringContaining("status = 'active', approval_challenge = NULL"),
			["44444444-4444-4444-8444-444444444444", "Browser", pairingPublicKey],
		);
	});

	it("stores only the user's opaque encrypted chat history backup", async () => {
		const query = vi.fn(async () => []);
		const chat = new ChatService(mockDataSource(query), {} as NotificationService);

		await chat.saveChatHistoryBackup(A, "encrypted-envelope");
		expect(query).toHaveBeenCalledWith(
			expect.stringContaining("ON CONFLICT (user_id) DO UPDATE"),
			[A, "encrypted-envelope"],
		);
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

		const chat = new ChatService(mockDataSource(query), {} as NotificationService);

		await expect(chat.approveMlsDevice(A, "55555555-5555-4555-8555-555555555555", targetDeviceId, signature)).resolves.toBeUndefined();
		expect(query).toHaveBeenCalledWith(
			expect.stringContaining("SET status = 'active'"),
			[targetDeviceId],
		);
		await expect(chat.approveMlsDevice(A, "55555555-5555-4555-8555-555555555555", targetDeviceId, "AAAA")).rejects.toThrow(/trusted device/i);
	});

	it("revokes only devices belonging to the authenticated user", async () => {
		const query = vi.fn(async (sql: string): Promise<unknown[]> => {
			if (sql.includes("UPDATE chat_mls_devices")) return [{ id: "44444444-4444-4444-8444-444444444444" }];
			return [];
		});
		const chat = new ChatService(mockDataSource(query), {} as NotificationService);

		await expect(chat.revokeMlsDevice(A, "44444444-4444-4444-8444-444444444444")).resolves.toBeUndefined();
		expect(query).toHaveBeenCalledWith(
			expect.stringContaining("WHERE id = $1 AND user_id = $2 AND status <> 'revoked'"),
			["44444444-4444-4444-8444-444444444444", A],
		);
		expect(query).toHaveBeenCalledWith(
			expect.stringContaining("UPDATE chat_mls_key_packages SET used_at"),
			["44444444-4444-4444-8444-444444444444"],
		);
	});

	it("claims an MLS key package once for a conversation member", async () => {
		let claimed = false;
		const query = vi.fn(async (sql: string): Promise<unknown[]> => {
			if (sql.includes("FROM chat_conversations c JOIN chat_members m")) return [{ kind: "direct", role: "member" }];
			if (sql.includes("UPDATE chat_mls_key_packages")) {
				if (claimed) return [];
				claimed = true;
				return [{ user_id: B, device_id: "55555555-5555-4555-8555-555555555555", key_package_id: "66666666-6666-4666-8666-666666666666", key_package: "AAAA" }];
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
			if (sql.includes("SELECT id FROM issue_reports")) return [{ id: "issue-report" }];
			if (sql.includes("SELECT user_id FROM chat_members")) return [{ user_id: B }, { user_id: A }];
			return [];
		});
		const chat = new ChatService(mockDataSource(query), {} as NotificationService);

		await expect(chat.deleteConversation(A, CONVERSATION)).resolves.toBeUndefined();
		expect(query).toHaveBeenCalledWith(expect.stringContaining("UPDATE issue_reports SET conversation_id = NULL, chat_open = false"), [CONVERSATION]);
		expect(query).toHaveBeenCalledWith("DELETE FROM chat_conversations WHERE id = $1", [CONVERSATION]);
	});

	it("lets an issue requester leave without deleting the conversation", async () => {
		const query = vi.fn(async (sql: string): Promise<unknown[]> => {
			if (sql.includes("SELECT value FROM settings")) return [{ value: false }];
			if (sql.includes("FROM chat_conversations c JOIN chat_members m")) return [{ kind: "group", role: "member" }];
			if (sql.includes("FROM chat_members m JOIN users")) return [{ id: B, username: "requester", display_name: "Requester", role: "member" }];
			if (sql.includes("DELETE FROM chat_members")) return [];
			if (sql.includes("SELECT user_id, role FROM chat_members")) return [{ user_id: A, role: "owner" }];
			if (sql.includes("SELECT user_id FROM chat_members")) return [{ user_id: A }];
			return [];
		});
		const chat = new ChatService(mockDataSource(query), {} as NotificationService);

		await expect(chat.removeMember(B, CONVERSATION, "requester")).resolves.toBeUndefined();
		expect(query).toHaveBeenCalledWith("DELETE FROM chat_members WHERE conversation_id = $1 AND user_id = $2", [CONVERSATION, B]);
		expect(query).not.toHaveBeenCalledWith("DELETE FROM chat_conversations WHERE id = $1", [CONVERSATION]);
	});

	it("closes a support chat when the last member leaves", async () => {
		const query = vi.fn(async (sql: string): Promise<unknown[]> => {
			if (sql.includes("FROM chat_conversations c JOIN chat_members m")) return [{ kind: "group", role: "member" }];
			if (sql.includes("FROM chat_members m JOIN users")) return [{ id: B, username: "requester", display_name: "Requester", role: "member" }];
			if (sql.includes("SELECT user_id FROM chat_members")) return [{ user_id: B }];
			return [];
		});
		const chat = new ChatService(mockDataSource(query), {} as NotificationService);

		await chat.removeMember(B, CONVERSATION, "requester");

		expect(query).toHaveBeenCalledWith(expect.stringContaining("UPDATE issue_reports SET conversation_id = NULL, chat_open = false"), [CONVERSATION]);
		expect(query).toHaveBeenCalledWith("DELETE FROM chat_conversations WHERE id = $1", [CONVERSATION]);
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
			if (sql.includes("SELECT kind, name")) return [{ kind: "group", name: "Issue: Playback" }];
			if (sql.includes("SELECT user_id FROM chat_members")) return [{ user_id: A }, { user_id: B }];
			return [];
		});
		const chat = new ChatService(mockDataSource(query), { send } as unknown as NotificationService);

		await chat.send(A, CONVERSATION, "Update");

		expect(insertCalls).toHaveLength(1);
		expect(insertCalls[0][0]).toContain("ON CONFLICT DO NOTHING RETURNING user_id");
		const rejoinIndex = query.mock.calls.findIndex(([sql]) => sql.includes("INSERT INTO chat_members"));
		const messageIndex = query.mock.calls.findIndex(([sql]) => sql.includes("INSERT INTO chat_messages") && sql.includes("'text'"));
		expect(messageIndex).toBeGreaterThan(rejoinIndex);
		expect(send).toHaveBeenCalledWith(expect.objectContaining({ url: `/chat/${CONVERSATION}` }), [B]);
		expect(query).not.toHaveBeenCalledWith(expect.stringContaining("DELETE FROM chat_messages"), expect.anything());
		expect(query).not.toHaveBeenCalledWith(expect.stringContaining("DELETE FROM chat_conversations"), expect.anything());
	});

	it("creates an issue support chat when the administrator is also the requester", async () => {
		const transactionQueries: Array<[string, unknown[]]> = [];
		const manager = {
			query: vi.fn(async (sql: string, params: unknown[] = []) => {
				transactionQueries.push([sql, params]);
				if (sql.includes("SELECT value FROM settings")) return [{ value: false }];
				return [];
			}),
		};
		const query = vi.fn(async (sql: string): Promise<unknown[]> => {
			if (sql.includes("SELECT user_id FROM chat_members")) return [{ user_id: A }];
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
			transaction: vi.fn(async (work: (manager: typeof manager) => Promise<unknown>) => work(manager)),
		} as unknown as DataSource;
		const chat = new ChatService(dataSource, {} as NotificationService);

		await chat.createSupportGroup(A, A, "Issue: Playback");

		const memberInserts = transactionQueries.filter(([sql]) => sql.includes("INSERT INTO chat_members"));
		expect(memberInserts).toHaveLength(1);
		expect(memberInserts[0][1]).toEqual([expect.any(String), A]);
		const conversationInsert = transactionQueries.find(([sql]) => sql.includes("INSERT INTO chat_conversations"));
		expect(conversationInsert?.[1]).toEqual([expect.any(String), "Issue: Playback", A, "plaintext"]);
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
		const { chat, query } = service();
		const listener = vi.fn();
		chat.onEvent(listener);

		await chat.supportChatChanged(CONVERSATION);

		expect(query).toHaveBeenCalledWith("SELECT user_id FROM chat_members WHERE conversation_id = $1", [CONVERSATION]);
		expect(listener).toHaveBeenCalledWith([B], { type: "changed", conversationId: CONVERSATION });
	});
});
