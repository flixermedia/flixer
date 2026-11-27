import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import { CLOSE_UNAUTHORIZED } from "../utils/socketCloseCodes.js";
import type { CallService } from "./callService.js";
import type { ChatEvent, ChatService } from "./chatService.js";
import { AuthService } from "../api/auth/authService.js";

export const CHAT_PATH = "/api/chat/live";

const AUTH_TIMEOUT_MS = 5_000;
const HEARTBEAT_INTERVAL_MS = 30_000;
const MAX_CLIENTS = 2_000;
const MAX_CLIENT_MESSAGE_BYTES = 262_144;
const MAX_SIGNAL_PAYLOAD_CHARS = 200_000;
const SIGNAL_WINDOW_MS = 10_000;
const MAX_SIGNALS_PER_WINDOW = 60;
const MAX_BUFFERED_BYTES = 1_024 * 1_024;
const MAX_PENDING_EVENTS = 256;

type ChatAuthenticator = (token: string) => Promise<string>;

export type PresenceStatus = "online" | "away" | "offline";

interface Connection {
	authenticated: boolean;
	userId?: string;
	username?: string;
	token?: string;
	activeTab: boolean;
	alive: boolean;
	signals: number[];
	delivery: Promise<void>;
	pendingEvents: number;
}

/**
 * Pushes chat events to signed-in users over one WebSocket per client.
 *
 * Protocol: the client sends `{"type":"auth","token":"..."}`; the server replies `{"type":"ready"}` and then streams
 * `{"type":"message","conversationId":"...","message":{...}}` for new messages and
 * `{"type":"changed","conversationId":"..."}` when a conversation's members, name or read state change.
 * Authenticated clients may also send `{"type":"call-signal","conversationId":"...","callId":"...","to"?:"userId","payload":"..."}`;
 * the server checks membership and relays `{"type":"call-signal","conversationId","callId","from","payload"}` to the other
 * members without storing it. The payload is MLS-encrypted by the client, so the server never sees call keys or SDP.
 * Sending messages stays on the REST API so validation, rate limiting and notifications live in one place.
 */
export class ChatSocketServer {

	private readonly wss = new WebSocketServer({ noServer: true, maxPayload: MAX_CLIENT_MESSAGE_BYTES });
	private readonly connections = new Map<WebSocket, Connection>();
	private server?: Server;
	private heartbeat?: NodeJS.Timeout;
	private unsubscribe?: () => void;
	private unsubscribeSignals?: () => void;
	private readonly onUpgrade = (request: IncomingMessage, socket: Duplex, head: Buffer) => this.handleUpgrade(request, socket, head);

	constructor(
		private readonly authenticate: ChatAuthenticator,
		private readonly chat: ChatService,
		private readonly calls?: CallService,
	) {}

	attach(server: Server): void {
		server.on("upgrade", this.onUpgrade);
		this.unsubscribe = this.chat.onEvent((userIds, event) => this.dispatch(userIds, event));
		this.unsubscribeSignals = typeof this.calls?.onSignal === "function" ? this.calls.onSignal((userIds, signal) => this.dispatch(userIds, signal)) : undefined;
		this.heartbeat = setInterval(() => this.pingClients(), HEARTBEAT_INTERVAL_MS);
		this.heartbeat.unref();
		this.server = server;
	}

	close(): void {
		clearInterval(this.heartbeat);
		this.unsubscribe?.();
		this.unsubscribeSignals?.();
		this.server?.off("upgrade", this.onUpgrade);
		for (const ws of this.connections.keys()) {
			ws.close(1001, "Server shutting down");
		}
		this.wss.close();
	}

	private dispatch(userIds: string[], event: ChatEvent | Record<string, unknown>): void {
		const targets = new Set(userIds);
		for (const [ws, connection] of this.connections) {
			if (connection.userId && targets.has(connection.userId)) {
				if (connection.pendingEvents >= MAX_PENDING_EVENTS) {
					ws.close(1013, "Client is too slow");
					continue;
				}
				connection.pendingEvents++;
				connection.delivery = connection.delivery.then(() => this.sendAuthenticated(ws, connection, event)).finally(() => connection.pendingEvents--);
			}
		}
	}

	private async sendAuthenticated(ws: WebSocket, connection: Connection, event: unknown): Promise<void> {
		if (await this.revalidate(ws, connection)) {
			this.send(ws, event);
		}
	}

	private async revalidate(ws: WebSocket, connection: Connection): Promise<boolean> {
		if (!connection.token || !connection.userId || ws.readyState !== WebSocket.OPEN) {
			return false;
		}
		let userId: string;
		try {
			userId = await this.authenticate(connection.token);
		} catch {
			ws.close(CLOSE_UNAUTHORIZED, "Sign in to receive messages");
			return false;
		}
		if (userId === connection.userId && ws.readyState === WebSocket.OPEN) {
			return true;
		}
		ws.close(CLOSE_UNAUTHORIZED, "Sign in to receive messages");
		return false;
	}

	private handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void {
		if (new URL(request.url ?? "/", "http://localhost").pathname !== CHAT_PATH) {
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
		const connection: Connection = {
			authenticated: false,
			activeTab: true,
			alive: true,
			signals: [],
			delivery: Promise.resolve(),
			pendingEvents: 0,
		};
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
			const username = connection.username;
			const prev = username ? this.userPresence(username) : "offline";
			this.connections.delete(ws);
			if (username) {
				const next = this.userPresence(username);
				if (next !== prev) this.broadcastPresence(username, next);
			}
		});
	}

	private userPresence(username: string): PresenceStatus {
		let hasAny = false;
		for (const conn of this.connections.values()) {
			if (!conn.authenticated || conn.username !== username) continue;
			if (conn.activeTab) return "online";
			hasAny = true;
		}
		return hasAny ? "away" : "offline";
	}

	private presenceSnapshot(): Record<string, PresenceStatus> {
		const map: Record<string, PresenceStatus> = {};
		for (const conn of this.connections.values()) {
			if (!conn.authenticated || !conn.username) continue;
			if (conn.activeTab) {
				map[conn.username] = "online";
			} else if (!map[conn.username]) {
				map[conn.username] = "away";
			}
		}
		return map;
	}

	private broadcastPresence(username: string, status: PresenceStatus): void {
		this.chat.setPresence?.(username, status, status !== "offline");
		const payload = { type: "presence", username, status };
		for (const [ws, conn] of this.connections) {
			if (conn.authenticated && conn.userId && ws.readyState === WebSocket.OPEN) {
				this.send(ws, payload);
			}
		}
	}

	private async onMessage(ws: WebSocket, connection: Connection, raw: RawData): Promise<void> {
		let message: { type?: unknown; token?: unknown; active?: unknown };
		try {
			message = JSON.parse(raw.toString()) as typeof message;
		} catch {
			ws.close(CLOSE_UNAUTHORIZED, "Invalid message");
			return;
		}
		if (connection.authenticated) {
			if (message.type === "presence" && typeof message.active === "boolean" && connection.username) {
				const prev = this.userPresence(connection.username);
				connection.activeTab = message.active;
				const next = this.userPresence(connection.username);
				if (next !== prev) this.broadcastPresence(connection.username, next);
				return;
			}
			if (message.type === "call-signal" && connection.userId && (await this.revalidate(ws, connection))) {
				await this.relaySignal(ws, connection.userId, connection, message as Record<string, unknown>);
			}
			return;
		}
		if (message.type !== "auth" || typeof message.token !== "string" || message.token === "") {
			ws.close(CLOSE_UNAUTHORIZED, "Expected an auth message");
			return;
		}
		// Set before awaiting so a second auth message cannot authenticate twice.
		connection.authenticated = true;
		try {
			connection.userId = await this.authenticate(message.token);
			connection.token = message.token;
			connection.activeTab = typeof message.active === "boolean" ? message.active : true;
			connection.username = (await this.chat.usernameForUser?.(connection.userId)) ?? undefined;
		} catch {
			connection.authenticated = false;
			ws.close(CLOSE_UNAUTHORIZED, "Sign in to receive messages");
			return;
		}
		this.send(ws, { type: "ready", presence: this.presenceSnapshot() });
		if (connection.username) {
			this.broadcastPresence(connection.username, this.userPresence(connection.username));
		}
	}

	private async relaySignal(ws: WebSocket, userId: string, connection: Connection, message: Record<string, unknown>): Promise<void> {
		const { conversationId, callId, to, payload } = message;
		const now = Date.now();
		connection.signals = connection.signals.filter((at) => now - at < SIGNAL_WINDOW_MS);
		if (connection.signals.length >= MAX_SIGNALS_PER_WINDOW) {
			this.send(ws, { type: "call-error", callId, reason: "rate-limited" });
			return;
		}
		connection.signals.push(now);
		if (!this.calls || typeof conversationId !== "string" || !AuthService.isUuid(conversationId) || typeof callId !== "string" || !/^[\w-]{1,64}$/.test(callId) || typeof payload !== "string" || payload.length === 0 || payload.length > MAX_SIGNAL_PAYLOAD_CHARS || (to !== undefined && typeof to !== "string")) {
			this.send(ws, { type: "call-error", callId, reason: "invalid" });
			return;
		}
		let recipients: string[];
		try {
			recipients = await this.calls.recipients(userId, conversationId.toLowerCase());
		} catch {
			this.send(ws, { type: "call-error", callId, reason: "unavailable" });
			return;
		}
		if (!(await this.revalidate(ws, connection))) {
			return;
		}
		const targets = to === undefined ? recipients : recipients.filter((id) => id === to);
		const signal = {
			type: "call-signal" as const,
			conversationId: conversationId.toLowerCase(),
			callId,
			from: userId,
			payload,
		};
		if (typeof this.calls?.enqueueSignal === "function") {
			this.calls.enqueueSignal(targets, signal);
		} else {
			this.dispatch(targets, signal);
		}
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
			if (connection.userId) {
				void this.revalidate(ws, connection);
			}
		}
	}
}
