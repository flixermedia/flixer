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
		expect(alice.received).toEqual([{ type: "ready" }]);
		expect(mallory.received).toEqual([]);

		chat.emit(["alice"], { type: "changed", conversationId: "c1" });
		await new Promise((resolve) => setTimeout(resolve, 50));
		expect(alice.received).toContainEqual({ type: "changed", conversationId: "c1" });
		expect(bob.received).toEqual([{ type: "ready" }]);
		for (const { ws } of [alice, bob, mallory]) ws.close();
	});
});
