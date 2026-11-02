import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import { CLOSE_UNAUTHORIZED } from "../../logs/liveLogSocketServer.js";
import type { NotificationEvent, NotificationService } from "./notificationService.js";

export const NOTIFICATION_PATH = "/api/notifications/live";

const AUTH_TIMEOUT_MS = 5_000;
const HEARTBEAT_INTERVAL_MS = 30_000;
const REVALIDATE_INTERVAL_MS = 60_000;
const MAX_CLIENTS = 2_000;
const MAX_CLIENT_MESSAGE_BYTES = 2_048;
const MAX_BUFFERED_BYTES = 1_024 * 1_024;

export type NotificationAuthenticator = (token: string) => Promise<string>;

interface Connection {
	authenticated: boolean;
	token?: string;
	userId?: string;
	alive: boolean;
}

/** Pushes inbox-change signals to authenticated users; notification contents remain on the REST API. */
export class NotificationSocketServer {

	private readonly wss = new WebSocketServer({ noServer: true, maxPayload: MAX_CLIENT_MESSAGE_BYTES });
	private readonly connections = new Map<WebSocket, Connection>();
	private server?: Server;
	private heartbeat?: NodeJS.Timeout;
	private revalidation?: NodeJS.Timeout;
	private unsubscribe?: () => void;
	private readonly onUpgrade = (request: IncomingMessage, socket: Duplex, head: Buffer) =>
		this.handleUpgrade(request, socket, head);

	constructor(
		private readonly authenticate: NotificationAuthenticator,
		private readonly notifications: NotificationService,
	) {}

	attach(server: Server): void {
		server.on("upgrade", this.onUpgrade);
		this.unsubscribe = this.notifications.onEvent((userIds, event) => this.dispatch(userIds, event));
		this.heartbeat = setInterval(() => this.pingClients(), HEARTBEAT_INTERVAL_MS);
		this.revalidation = setInterval(() => void this.revalidateClients(), REVALIDATE_INTERVAL_MS);
		this.heartbeat.unref();
		this.revalidation.unref();
		this.server = server;
	}

	close(): void {
		clearInterval(this.heartbeat);
		clearInterval(this.revalidation);
		this.unsubscribe?.();
		this.server?.off("upgrade", this.onUpgrade);
		for (const ws of this.connections.keys()) {
			ws.close(1001, "Server shutting down");
		}
		this.wss.close();
	}

	private dispatch(userIds: string[], event: NotificationEvent): void {
		const targets = new Set(userIds);
		for (const [ws, connection] of this.connections) {
			if (connection.userId && targets.has(connection.userId)) {
				this.send(ws, event);
			}
		}
	}

	private handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void {
		if (new URL(request.url ?? "/", "http://localhost").pathname !== NOTIFICATION_PATH) {
			return;
		}
		if (this.connections.size >= MAX_CLIENTS) {
			socket.write("HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n");
			socket.destroy();
			return;
		}
		this.wss.handleUpgrade(request, socket, head, (ws) => this.onConnection(ws));
	}

	private onConnection(ws: WebSocket): void {
		const connection: Connection = { authenticated: false, alive: true };
		this.connections.set(ws, connection);
		const authTimer = setTimeout(() => {
			if (!connection.userId) {
				ws.close(CLOSE_UNAUTHORIZED, "Authentication timed out");
			}
		}, AUTH_TIMEOUT_MS);
		ws.on("pong", () => {
			connection.alive = true;
		});
		ws.on("message", (raw) => void this.onMessage(ws, connection, raw));
		ws.on("error", () => ws.terminate());
		ws.on("close", () => {
			clearTimeout(authTimer);
			this.connections.delete(ws);
		});
	}

	private async onMessage(ws: WebSocket, connection: Connection, raw: RawData): Promise<void> {
		if (connection.authenticated) {
			return;
		}
		const token = parseAuthMessage(raw);
		if (!token) {
			ws.close(CLOSE_UNAUTHORIZED, "Expected an auth message");
			return;
		}
		connection.authenticated = true;
		try {
			connection.userId = await this.authenticate(token);
		} catch {
			connection.authenticated = false;
			ws.close(CLOSE_UNAUTHORIZED, "Sign in to receive notifications");
			return;
		}
		if (ws.readyState !== WebSocket.OPEN) {
			return;
		}
		connection.token = token;
		this.send(ws, { type: "ready" });
	}

	private send(ws: WebSocket, message: unknown): void {
		if (ws.readyState !== WebSocket.OPEN) {
			return;
		}
		if (ws.bufferedAmount > MAX_BUFFERED_BYTES) {
			ws.close(1013, "Client is too slow");
			return;
		}
		ws.send(JSON.stringify(message));
	}

	private pingClients(): void {
		for (const [ws, connection] of this.connections) {
			if (!connection.alive) {
				ws.terminate();
				continue;
			}
			connection.alive = false;
			ws.ping();
		}
	}

	private async revalidateClients(): Promise<void> {
		await Promise.all(
			[...this.connections].map(async ([ws, connection]) => {
				if (!connection.token) {
					return;
				}
				try {
					await this.authenticate(connection.token);
				} catch {
					ws.close(CLOSE_UNAUTHORIZED, "Access revoked");
				}
			}),
		);
	}
}

function parseAuthMessage(raw: RawData): string | null {

	try {
		const message = JSON.parse(raw.toString()) as { type?: unknown; token?: unknown };
		return message.type === "auth" && typeof message.token === "string" && message.token !== ""
			? message.token
			: null;
	} catch {
		return null;
	}

}
