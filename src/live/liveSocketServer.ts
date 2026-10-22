import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import { CLOSE_FORBIDDEN, CLOSE_UNAUTHORIZED } from "../logs/liveLogSocketServer.js";
import { isLiveTopic, type LiveHub, type LiveTopic } from "./liveHub.js";

export const LIVE_PATH = "/api/live";

const AUTH_TIMEOUT_MS = 5_000;
const REVALIDATE_INTERVAL_MS = 60_000;
const HEARTBEAT_INTERVAL_MS = 30_000;
const MAX_CLIENTS = 50;
const MAX_CLIENT_MESSAGE_BYTES = 4_096;
const MAX_BUFFERED_BYTES = 4 * 1_024 * 1_024;

/** Resolves with the caller's session when the token belongs to an administrator, and rejects (optionally with `status`) otherwise. */
export type LiveAuthenticator = (token: string) => Promise<{ sessionId: string }>;

interface Connection {
	authenticated: boolean;
	token?: string;
	sessionId?: string;
	subscriptions: Map<LiveTopic, () => void>;
	alive: boolean;
}

/**
 * Pushes admin dashboard data (overview, streams, devices, indexer, network shares) over one WebSocket.
 *
 * Protocol: the client sends `{"type":"auth","token":"<access token>"}` first (browsers cannot set an
 * Authorization header on a WebSocket, and a token in the URL would end up in proxy logs) and gets
 * `{"type":"ready"}`. It then sends `{"type":"subscribe","topic":"streams"}` or `{"type":"unsubscribe",...}`.
 * The server answers every subscription with the current data and then again each time it changes:
 * `{"type":"data","topic":"streams","data":...}`.
 */
export class LiveSocketServer {

	private readonly wss = new WebSocketServer({ noServer: true, maxPayload: MAX_CLIENT_MESSAGE_BYTES });
	private readonly connections = new Map<WebSocket, Connection>();
	private server?: Server;
	private heartbeat?: NodeJS.Timeout;
	private revalidation?: NodeJS.Timeout;
	private readonly onUpgrade = (request: IncomingMessage, socket: Duplex, head: Buffer) => this.handleUpgrade(request, socket, head);

	constructor(
		private readonly authenticate: LiveAuthenticator,
		private readonly hub: LiveHub,
		private readonly path: string = LIVE_PATH,
	) {}

	attach(server: Server): void {
		server.on("upgrade", this.onUpgrade);
		this.heartbeat = setInterval(() => this.pingClients(), HEARTBEAT_INTERVAL_MS);
		this.revalidation = setInterval(() => void this.revalidateClients(), REVALIDATE_INTERVAL_MS);
		this.heartbeat.unref();
		this.revalidation.unref();
		this.server = server;
	}

	close(): void {
		clearInterval(this.heartbeat);
		clearInterval(this.revalidation);
		this.server?.off("upgrade", this.onUpgrade);
		for (const ws of this.connections.keys()) {
			ws.close(1001, "Server shutting down");
		}
		this.wss.close();
		this.hub.close();
	}

	private handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void {
		const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
		if (pathname !== this.path) {
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
		const connection: Connection = { authenticated: false, subscriptions: new Map(), alive: true };
		this.connections.set(ws, connection);

		const authTimer = setTimeout(() => {
			if (!connection.authenticated) {
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
			for (const unsubscribe of connection.subscriptions.values()) {
				unsubscribe();
			}
			connection.subscriptions.clear();
			this.connections.delete(ws);
		});
	}

	private async onMessage(ws: WebSocket, connection: Connection, raw: RawData): Promise<void> {
		const message = parseMessage(raw);
		if (!message) {
			ws.close(CLOSE_UNAUTHORIZED, "Invalid message");
			return;
		}

		if (!connection.authenticated) {
			await this.onAuth(ws, connection, message);
			return;
		}
		if (!connection.sessionId || !isLiveTopic(message.topic)) {
			return;
		}

		if (message.type === "subscribe" && !connection.subscriptions.has(message.topic)) {
			const unsubscribe = this.hub.subscribe(message.topic, { sessionId: connection.sessionId }, (topic, data) => {
				if (ws.bufferedAmount > MAX_BUFFERED_BYTES) {
					ws.close(1013, "Client is too slow");
					return;
				}
				this.send(ws, { type: "data", topic, data });
			});
			connection.subscriptions.set(message.topic, unsubscribe);
		} else if (message.type === "unsubscribe") {
			connection.subscriptions.get(message.topic)?.();
			connection.subscriptions.delete(message.topic);
		}
	}

	private async onAuth(ws: WebSocket, connection: Connection, message: ClientMessage): Promise<void> {
		if (message.type !== "auth" || typeof message.token !== "string" || message.token === "") {
			ws.close(CLOSE_UNAUTHORIZED, "Expected an auth message");
			return;
		}
		// Set before awaiting so a second auth message cannot authenticate twice.
		connection.authenticated = true;
		try {
			const { sessionId } = await this.authenticate(message.token);
			connection.sessionId = sessionId;
		} catch (error) {
			connection.authenticated = false;
			ws.close(closeCodeFor(error), "Administrator access is required");
			return;
		}
		connection.token = message.token;
		this.send(ws, { type: "ready" });
	}

	private send(ws: WebSocket, message: unknown): void {
		if (ws.readyState === WebSocket.OPEN) {
			ws.send(JSON.stringify(message));
		}
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

	/** Access can be revoked (logout, role change) while a socket is open, so re-check periodically. */
	private async revalidateClients(): Promise<void> {
		await Promise.all(
			[...this.connections].map(async ([ws, connection]) => {
				if (!connection.token) {
					return;
				}
				try {
					await this.authenticate(connection.token);
				} catch (error) {
					ws.close(closeCodeFor(error), "Access revoked");
				}
			}),
		);
	}
}

interface ClientMessage {
	type?: unknown;
	token?: unknown;
	topic?: unknown;
}

function parseMessage(raw: RawData): (ClientMessage & { type: string }) | null {
	try {
		const message = JSON.parse(raw.toString()) as ClientMessage;
		return typeof message === "object" && message !== null && typeof message.type === "string" ? (message as ClientMessage & { type: string }) : null;
	} catch {
		return null;
	}
}

function closeCodeFor(error: unknown): number {
	const status = (error as { status?: number } | null)?.status;
	return status === 403 ? CLOSE_FORBIDDEN : CLOSE_UNAUTHORIZED;
}
