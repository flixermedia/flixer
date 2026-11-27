import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { WebSocket } from "ws";
import { afterEach, describe, expect, it } from "vitest";
import { ChatSocketServer } from "./chatSocketServer.js";
import type { ChatEvent } from "./chatService.js";

function fakeChat() {

	const listeners = new Set<(ids: string[], event: ChatEvent) => void>();
	return {
		onEvent: (listener: (ids: string[], event: ChatEvent) => void) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		emit: (ids: string[], event: ChatEvent) => listeners.forEach((listener) => listener(ids, event)),
	};

}

async function open(port: number, token: string): Promise<{ ws: WebSocket; received: unknown[] }> {

	const ws = new WebSocket(`ws://127.0.0.1:${port}/api/chat/live`);
	const received: unknown[] = [];
	ws.on("message", (raw) => received.push(JSON.parse(raw.toString())));
	await new Promise((resolve) => ws.once("open", resolve));
	ws.send(JSON.stringify({ type: "auth", token }));
	await new Promise<void>((resolve) => {
		const check = setInterval(() => {
			if (received.length > 0 || ws.readyState === WebSocket.CLOSED) {
				clearInterval(check);
				resolve();
			}
		}, 10);
	});
	return { ws, received };

}

describe("ChatSocketServer", () => {
	let server: Server;
	let sockets: ChatSocketServer;

	afterEach(() => {
		sockets.close();
		server.close();
	});

	it("delivers events only to the addressed users", async () => {
		const chat = fakeChat();
		server = createServer();
		sockets = new ChatSocketServer(async (token) => {
			if (token === "bad") throw new Error("no");
			return token;
		}, chat as never);
		sockets.attach(server);
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
		const port = (server.address() as AddressInfo).port;

		const alice = await open(port, "alice");
		const bob = await open(port, "bob");
		const mallory = await open(port, "bad");
		expect(alice.received).toEqual([{ type: "ready", presence: {} }]);
		expect(mallory.received).toEqual([]);

		chat.emit(["alice"], { type: "changed", conversationId: "c1" });
		await new Promise((resolve) => setTimeout(resolve, 50));
		expect(alice.received).toContainEqual({ type: "changed", conversationId: "c1" });
		expect(bob.received).toEqual([{ type: "ready", presence: {} }]);
		for (const { ws } of [alice, bob, mallory]) ws.close();
	});

	it("relays call signals to other members only and rejects non-members", async () => {
		const chat = fakeChat();
		const conversationId = "11111111-1111-4111-8111-111111111111";
		const calls = {
			recipients: async (userId: string, id: string) => {
				if (id !== conversationId || userId === "mallory") throw new Error("no");
				return ["alice", "bob", "carol"].filter((member) => member !== userId);
			},
		};
		server = createServer();
		sockets = new ChatSocketServer(async (token) => token, chat as never, calls as never);
		sockets.attach(server);
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
		const port = (server.address() as AddressInfo).port;

		const alice = await open(port, "alice");
		const bob = await open(port, "bob");
		const carol = await open(port, "carol");
		const mallory = await open(port, "mallory");

		alice.ws.send(JSON.stringify({ type: "call-signal", conversationId, callId: "c1", to: "bob", payload: "sealed" }));
		mallory.ws.send(JSON.stringify({ type: "call-signal", conversationId, callId: "c2", payload: "x" }));
		alice.ws.send(JSON.stringify({ type: "call-signal", conversationId, callId: "c3", payload: "" }));
		await new Promise((resolve) => setTimeout(resolve, 100));

		expect(bob.received).toContainEqual({ type: "call-signal", conversationId, callId: "c1", from: "alice", payload: "sealed" });
		expect(carol.received).toEqual([{ type: "ready", presence: {} }]);
		expect(mallory.received).toContainEqual({ type: "call-error", callId: "c2", reason: "unavailable" });
		expect(alice.received).toContainEqual({ type: "call-error", callId: "c3", reason: "invalid" });
		for (const { ws } of [alice, bob, carol, mallory]) ws.close();
	});

	it("rejects call signals after the sending session is revoked", async () => {
		const chat = fakeChat();
		const conversationId = "11111111-1111-4111-8111-111111111111";
		const revoked = new Set<string>();
		const calls = { recipients: async () => ["bob"] };
		server = createServer();
		sockets = new ChatSocketServer(
			async (token) => {
				if (revoked.has(token)) throw new Error("revoked");
				return token;
			},
			chat as never,
			calls as never,
		);
		sockets.attach(server);
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
		const port = (server.address() as AddressInfo).port;
		const alice = await open(port, "alice");
		const bob = await open(port, "bob");
		const closed = new Promise<number>((resolve) => alice.ws.once("close", resolve));

		revoked.add("alice");
		alice.ws.send(JSON.stringify({ type: "call-signal", conversationId, callId: "c1", payload: "sealed" }));
		expect(await closed).toBe(4401);
		await new Promise((resolve) => setTimeout(resolve, 50));
		expect(bob.received).toEqual([{ type: "ready", presence: {} }]);
		bob.ws.close();
	});

	it("does not deliver events to a revoked session of an otherwise valid user", async () => {
		const chat = fakeChat();
		const revoked = new Set<string>();
		server = createServer();
		sockets = new ChatSocketServer(async (token) => {
			if (revoked.has(token)) throw new Error("revoked");
			return "alice";
		}, chat as never);
		sockets.attach(server);
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
		const port = (server.address() as AddressInfo).port;
		const oldSession = await open(port, "old-session");
		const validSession = await open(port, "valid-session");
		const closed = new Promise<number>((resolve) => oldSession.ws.once("close", resolve));

		revoked.add("old-session");
		chat.emit(["alice"], { type: "changed", conversationId: "c1" });
		expect(await closed).toBe(4401);
		await new Promise((resolve) => setTimeout(resolve, 50));
		expect(oldSession.received).toEqual([{ type: "ready", presence: {} }]);
		expect(validSession.received).toContainEqual({ type: "changed", conversationId: "c1" });
		validSession.ws.close();
	});

	it("does not relay a signal if its session is revoked during recipient lookup", async () => {
		const chat = fakeChat();
		const conversationId = "11111111-1111-4111-8111-111111111111";
		let revoked = false;
		let finishLookup!: (recipients: string[]) => void;
		let lookupStarted!: () => void;
		const started = new Promise<void>((resolve) => {
			lookupStarted = resolve;
		});
		const calls = {
			recipients: () => {
				lookupStarted();
				return new Promise<string[]>((resolve) => {
					finishLookup = resolve;
				});
			},
		};
		server = createServer();
		sockets = new ChatSocketServer(
			async (token) => {
				if (token === "alice" && revoked) throw new Error("revoked");
				return token;
			},
			chat as never,
			calls as never,
		);
		sockets.attach(server);
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
		const port = (server.address() as AddressInfo).port;
		const alice = await open(port, "alice");
		const bob = await open(port, "bob");
		const closed = new Promise<number>((resolve) => alice.ws.once("close", resolve));

		alice.ws.send(JSON.stringify({ type: "call-signal", conversationId, callId: "c1", payload: "sealed" }));
		await started;
		revoked = true;
		finishLookup(["bob"]);
		expect(await closed).toBe(4401);
		await new Promise((resolve) => setTimeout(resolve, 50));
		expect(bob.received).toEqual([{ type: "ready", presence: {} }]);
		bob.ws.close();
	});

	it("preserves event order while revalidating a session", async () => {
		const chat = fakeChat();
		let checks = 0;
		let finishCheck!: () => void;
		let checkStarted!: () => void;
		const started = new Promise<void>((resolve) => {
			checkStarted = resolve;
		});
		server = createServer();
		sockets = new ChatSocketServer(async (token) => {
			if (++checks === 2) {
				checkStarted();
				await new Promise<void>((resolve) => {
					finishCheck = resolve;
				});
			}
			return token;
		}, chat as never);
		sockets.attach(server);
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
		const port = (server.address() as AddressInfo).port;
		const alice = await open(port, "alice");

		chat.emit(["alice"], { type: "changed", conversationId: "first" });
		await started;
		chat.emit(["alice"], { type: "changed", conversationId: "second" });
		await new Promise((resolve) => setTimeout(resolve, 50));
		expect(alice.received).toEqual([{ type: "ready", presence: {} }]);
		finishCheck();
		await new Promise((resolve) => setTimeout(resolve, 50));
		expect(alice.received).toEqual([{ type: "ready", presence: {} }, { type: "changed", conversationId: "first" }, { type: "changed", conversationId: "second" }]);
		alice.ws.close();
	});

	it("closes a connection when pending event validation exceeds its limit", async () => {
		const chat = fakeChat();
		let checks = 0;
		let finishCheck!: () => void;
		let checkStarted!: () => void;
		const started = new Promise<void>((resolve) => {
			checkStarted = resolve;
		});
		server = createServer();
		sockets = new ChatSocketServer(async (token) => {
			if (++checks === 2) {
				checkStarted();
				await new Promise<void>((resolve) => {
					finishCheck = resolve;
				});
			}
			return token;
		}, chat as never);
		sockets.attach(server);
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
		const port = (server.address() as AddressInfo).port;
		const alice = await open(port, "alice");
		const closed = new Promise<number>((resolve) => alice.ws.once("close", resolve));

		chat.emit(["alice"], { type: "changed", conversationId: "c1" });
		await started;
		for (let index = 0; index < 256; index++) {
			chat.emit(["alice"], { type: "changed", conversationId: "c1" });
		}
		expect(await closed).toBe(1013);
		finishCheck();
		expect(alice.received).toEqual([{ type: "ready", presence: {} }]);
	});
});
