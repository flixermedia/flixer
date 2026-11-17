import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { WebSocket } from "ws";
import { afterEach, describe, expect, it } from "vitest";
import { NotificationSocketServer } from "./notificationSocketServer.js";
import type { NotificationEvent } from "./notificationService.js";

function fakeNotifications() {

	const listeners = new Set<(ids: string[], event: NotificationEvent) => void>();
	return {
		onEvent: (listener: (ids: string[], event: NotificationEvent) => void) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		emit: (ids: string[], event: NotificationEvent) => listeners.forEach((listener) => listener(ids, event)),
	};

}

async function open(port: number, token: string): Promise<{ ws: WebSocket; received: unknown[] }> {

	const ws = new WebSocket(`ws://127.0.0.1:${port}/api/notifications/live`);
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

describe("NotificationSocketServer", () => {
	let server: Server;
	let sockets: NotificationSocketServer;

	afterEach(() => {
		sockets.close();
		server.close();
	});

	it("delivers inbox change signals only to the addressed users", async () => {
		const notifications = fakeNotifications();
		server = createServer();
		sockets = new NotificationSocketServer(async (token) => {
			if (token === "bad") throw new Error("unauthorized");
			return token;
		}, notifications as never);
		sockets.attach(server);
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
		const port = (server.address() as AddressInfo).port;

		const alice = await open(port, "alice");
		const bob = await open(port, "bob");
		const unauthorized = await open(port, "bad");
		expect(alice.received).toEqual([{ type: "ready" }]);
		expect(unauthorized.received).toEqual([]);

		notifications.emit(["alice"], { type: "changed" });
		await new Promise((resolve) => setTimeout(resolve, 50));
		expect(alice.received).toContainEqual({ type: "changed" });
		expect(bob.received).toEqual([{ type: "ready" }]);

		for (const { ws } of [alice, bob, unauthorized]) ws.close();
	});
});
