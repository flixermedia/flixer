import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import { CLOSE_UNAUTHORIZED } from "../logs/liveLogSocketServer.js";
import { AuthService } from "../api/auth/authService.js";
import type { PartiesService, PartyPerson } from "./partiesService.js";

export const PARTY_PATH = "/api/party";

const AUTH_TIMEOUT_MS = 5_000;
const HEARTBEAT_INTERVAL_MS = 30_000;
const MAX_CLIENTS = 500;
const MAX_CLIENT_MESSAGE_BYTES = 1_024;
const MAX_BUFFERED_BYTES = 1_024 * 1_024;

export type PartyAuthenticator = (token: string) => Promise<PartyPerson>;

interface Connection {
	authenticated: boolean;
	person?: PartyPerson;
	partyId?: string;
	leave?: () => void;
	alive: boolean;
}

/**
 * Carries party state over one WebSocket per client.
 *
 * Protocol: `{"type":"auth","token":"..."}` first, then `{"type":"join","partyId":"..."}`. The server answers with
 * `{"type":"state","party":...,"serverTime":...}` on every change and `{"type":"ended"}` when the party is over.
 * The host sends `{"type":"control","playing":true,"position":12.5,"itemId":"..."}` whenever playback changes and as a heartbeat.
 */
export class PartySocketServer {
	private readonly wss = new WebSocketServer({ noServer: true, maxPayload: MAX_CLIENT_MESSAGE_BYTES });
	private readonly connections = new Map<WebSocket, Connection>();
	private server?: Server;
	private heartbeat?: NodeJS.Timeout;
	private readonly onUpgrade = (request: IncomingMessage, socket: Duplex, head: Buffer) =>
		this.handleUpgrade(request, socket, head);

	constructor(
		private readonly authenticate: PartyAuthenticator,
		private readonly parties: PartiesService,
	) {}

	attach(server: Server): void {
		server.on("upgrade", this.onUpgrade);
		this.heartbeat = setInterval(() => this.pingClients(), HEARTBEAT_INTERVAL_MS);
		this.heartbeat.unref();
		this.server = server;
	}

	close(): void {
		clearInterval(this.heartbeat);
		this.server?.off("upgrade", this.onUpgrade);
		for (const ws of this.connections.keys()) {
			ws.close(1001, "Server shutting down");
		}
		this.wss.close();
	}

	private handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void {
		if (new URL(request.url ?? "/", "http://localhost").pathname !== PARTY_PATH) {
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
			connection.leave?.();
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
		const person = connection.person;
		if (!person) {
			return;
		}

		try {
			if (message.type === "join" && typeof message.partyId === "string") {
				connection.leave?.();
				connection.leave = undefined;
				const { snapshot, leave } = this.parties.join(message.partyId, person, (outgoing) =>
					this.send(ws, outgoing),
				);
				connection.leave = leave;
				connection.partyId = message.partyId;
				this.send(ws, { type: "state", party: snapshot, serverTime: Date.now() });
				this.send(ws, { type: "chat-history", messages: this.parties.chatHistory(message.partyId) });
			} else if (message.type === "chat" && connection.partyId && typeof message.text === "string") {
				this.parties.chat(connection.partyId, person, message.text);
			} else if (message.type === "leave") {
				connection.leave?.();
				connection.leave = undefined;
				connection.partyId = undefined;
			} else if (message.type === "control" && connection.partyId) {
				await this.parties.control(connection.partyId, person.id, {
					itemId: typeof message.itemId === "string" ? message.itemId : undefined,
					playing: message.playing === true,
					position: typeof message.position === "number" ? message.position : 0,
				});
			} else if (message.type === "end" && connection.partyId) {
				this.parties.endBy(connection.partyId, person.id);
			}
		} catch (error) {
			const { status, message: text } = error as { status?: number; message?: string };
			this.send(ws, { type: "error", status: status ?? 500, message: text ?? "Something went wrong." });
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
			connection.person = await this.authenticate(message.token);
		} catch {
			connection.authenticated = false;
			ws.close(CLOSE_UNAUTHORIZED, "Sign in to join a party");
			return;
		}
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
}

interface ClientMessage {
	type: string;
	token?: unknown;
	partyId?: unknown;
	itemId?: unknown;
	playing?: unknown;
	position?: unknown;
}

function parseMessage(raw: RawData): ClientMessage | null {
	try {
		const message = JSON.parse(raw.toString()) as Partial<ClientMessage>;
		return typeof message === "object" && message !== null && typeof message.type === "string"
			? (message as ClientMessage)
			: null;
	} catch {
		return null;
	}
}

export function personFrom(user: Awaited<ReturnType<AuthService["getAuthenticatedUser"]>>): PartyPerson {
	return {
		id: user.id,
		username: user.username,
		displayName: user.displayName || user.username,
		avatarUrl: user.avatarUrl,
	};
}
