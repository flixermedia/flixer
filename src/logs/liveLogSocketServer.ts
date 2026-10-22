import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import { liveLogHub, type LiveLogHub } from "./liveLogHub.js";

export const LIVE_LOG_PATH = "/api/logs/stream";

/** Close codes sent to clients. 4401/4403 mean "do not reconnect with the same credentials". */
export const CLOSE_UNAUTHORIZED = 4401;
export const CLOSE_FORBIDDEN = 4403;

const AUTH_TIMEOUT_MS = 5_000;
const REVALIDATE_INTERVAL_MS = 60_000;
const HEARTBEAT_INTERVAL_MS = 30_000;
const MAX_CLIENTS = 10;
const MAX_CLIENT_MESSAGE_BYTES = 4_096;
const MAX_BUFFERED_BYTES = 1_024 * 1_024;

/** Resolves when the token belongs to an administrator and rejects (optionally with `status`) otherwise. */
export type AdminAuthenticator = (token: string) => Promise<void>;

interface Connection {
	authenticated: boolean;
	token?: string;
	unsubscribe?: () => void;
	alive: boolean;
}

/**
 * Streams log entries to administrators over a WebSocket.
 *
 * Protocol: the client opens the socket and immediately sends `{"type":"auth","token":"<access token>"}`
 * (browsers cannot set an Authorization header on a WebSocket, and a token in the URL would end up
 * in proxy logs). The server answers with `{"type":"snapshot","entries":[...]}` followed by one
 * `{"type":"log","entry":{...}}` per new entry.
 */
export class LiveLogSocketServer {

	private readonly wss = new WebSocketServer({ noServer: true, maxPayload: MAX_CLIENT_MESSAGE_BYTES });
	private readonly connections = new Map<WebSocket, Connection>();
	private server?: Server;
	private heartbeat?: NodeJS.Timeout;
	private revalidation?: NodeJS.Timeout;
	private readonly onUpgrade = (request: IncomingMessage, socket: Duplex, head: Buffer) => this.handleUpgrade(request, socket, head);

	constructor(
		private readonly authenticate: AdminAuthenticator,
		private readonly hub: LiveLogHub = liveLogHub,
		private readonly path: string = LIVE_LOG_PATH,
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
	}

	get clientCount(): number {
		return this.connections.size;
	}

	private handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void {
		const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
		if (pathname !== this.path) {
			// Another socket server (or nobody) owns this path.
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
			connection.unsubscribe?.();
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
		// Set before awaiting so a second auth message cannot start a second subscription.
		connection.authenticated = true;
		try {
			await this.authenticate(token);
		} catch (error) {
			connection.authenticated = false;
			ws.close(closeCodeFor(error), "Administrator access is required");
			return;
		}
		if (ws.readyState !== WebSocket.OPEN) {
			return;
		}

		connection.token = token;
		this.send(ws, { type: "snapshot", entries: this.hub.snapshot() });
		connection.unsubscribe = this.hub.subscribe((entry) => {
			if (ws.bufferedAmount > MAX_BUFFERED_BYTES) {
				ws.close(1013, "Client is too slow");
				return;
			}
			this.send(ws, { type: "log", entry });
		});
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

function parseAuthMessage(raw: RawData): string | null {
	try {
		const message = JSON.parse(raw.toString()) as { type?: unknown; token?: unknown };
		return message.type === "auth" && typeof message.token === "string" && message.token !== "" ? message.token : null;
	} catch {
		return null;
	}
}

function closeCodeFor(error: unknown): number {
	const status = (error as { status?: number } | null)?.status;
	return status === 403 ? CLOSE_FORBIDDEN : CLOSE_UNAUTHORIZED;
}
