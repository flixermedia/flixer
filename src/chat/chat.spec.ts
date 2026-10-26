import { describe, expect, it, vi } from "vitest";
import type { DataSource } from "typeorm";
import type { NotificationService } from "../api/notifications/notificationService.js";
import { ChatService, cleanMessage, cleanName, directKey, MAX_MESSAGE_LENGTH } from "./chatService.js";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const CONVERSATION = "33333333-3333-4333-8333-333333333333";

function service() {
	const send = vi.fn(async () => ({ recipients: 1, pushed: 0 }));
	const query = vi.fn(async (sql: string): Promise<unknown[]> => {
		if (sql.includes("FROM chat_conversations c JOIN chat_members m")) {
			return [{ kind: "direct", role: "member" }];
		}
		if (sql.includes("FROM chat_messages m")) {
			return [{ id: "m1", conversation_id: CONVERSATION, kind: "text", body: "hi", created_at: new Date(), username: "ann", display_name: "Ann", avatar_file: null }];
		}
		if (sql.includes("SELECT m.user_id FROM chat_members")) {
			return [{ user_id: B }];
		}
		if (sql.includes("SELECT kind, name")) {
			return [{ kind: "direct", name: null }];
		}
		return [];
	});
	const chat = new ChatService({ query } as unknown as DataSource, { send } as unknown as NotificationService);
	return { chat, query, send };
}

describe("chat helpers", () => {
	it("builds the same direct key for either order", () => {
		expect(directKey(A, B)).toBe(directKey(B, A));
	});

	it("trims messages and rejects empty or oversized ones", () => {
		expect(cleanMessage("  hello  ")).toBe("hello");
		expect(() => cleanMessage("   ")).toThrow();
		expect(() => cleanMessage("x".repeat(MAX_MESSAGE_LENGTH + 1))).toThrow();
	});

	it("collapses group name whitespace and enforces the length", () => {
		expect(cleanName("  Movie   night ")).toBe("Movie night");
		expect(() => cleanName("")).toThrow();
		expect(() => cleanName("x".repeat(61))).toThrow();
	});
});

describe("ChatService", () => {
	it("stores a message and notifies the other members with the thread link", async () => {
		const { chat, send } = service();
		const message = await chat.send(A, CONVERSATION, "hi");
		expect(message.body).toBe("hi");
		expect(send).toHaveBeenCalledWith(expect.objectContaining({ kind: "message", url: `/chat/${CONVERSATION}`, body: "hi" }), [B]);
	});

	it("limits how fast someone can send", async () => {
		const { chat } = service();
		for (let i = 0; i < 10; i++) {
			await chat.send(A, CONVERSATION, `m${i}`);
		}
		await expect(chat.send(A, CONVERSATION, "one more")).rejects.toThrow(/too quickly/);
	});
});
