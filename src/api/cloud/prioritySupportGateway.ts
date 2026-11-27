import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import { Inject, Injectable, logger } from "@tsed/di";
import { PlatformApplication } from "@tsed/platform-http";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import { AuthService } from "../auth/authService.js";
import { CLOSE_UNAUTHORIZED, closeCodeFor } from "../../utils/socketCloseCodes.js";
import {
	PrioritySupportService,
	type SupportChatAttachment,
	type SupportChatMessage,
	type SupportChatState,
	type SupportRealtimeConfig,
} from "./prioritySupportService.js";

export const PRIORITY_SUPPORT_WS_PATH = "/api/cloud/support/live";

const AUTH_TIMEOUT_MS = 5_000;
const HEARTBEAT_INTERVAL_MS = 30_000;
const SYNC_INTERVAL_MS = 5_000;
const UPSTREAM_RECONNECT_MS = 3_000;
const MAX_CLIENTS = 20;
const MAX_PAYLOAD_BYTES = 16_384;

interface SupportConnection {
	authenticated: boolean;
	alive: boolean;
}

@Injectable()
export class PrioritySupportGateway {

	private readonly wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD_BYTES });
	private readonly connections = new Map<WebSocket, SupportConnection>();
	private server?: Server;
	private heartbeatTimer?: NodeJS.Timeout;
	private syncTimer?: NodeJS.Timeout;
	private lastSnapshotJson = "";
	private currentRoom: { rid: string; open: boolean } | null = null;
	private upstreamWs?: WebSocket;
	private upstreamConfig?: SupportRealtimeConfig;
	private upstreamReconnectTimer?: NodeJS.Timeout;
	private readonly onUpgrade = (request: IncomingMessage, socket: Duplex, head: Buffer) => this.handleUpgrade(request, socket, head);

	constructor(
		private readonly authService: AuthService,
		private readonly prioritySupport: PrioritySupportService,
		@Inject(PlatformApplication) private readonly platformApp: PlatformApplication<{ server?: Server }>,
	) {}

	$onReady(): void {
		const server = this.platformApp.getApp().server;
		if (!server) {
			logger().warn("Priority Support WebSocket is unavailable: HTTP server not found.");
			return;
		}
		server.on("upgrade", this.onUpgrade);
		this.heartbeatTimer = setInterval(() => this.pingClients(), HEARTBEAT_INTERVAL_MS);
		this.heartbeatTimer.unref();
		this.server = server;
		logger().info(`Priority Support WebSocket is available on ${PRIORITY_SUPPORT_WS_PATH}.`);
	}

	$onDestroy(): void {
		clearInterval(this.heartbeatTimer);
		this.stopSyncLoop();
		this.server?.off("upgrade", this.onUpgrade);
		for (const ws of this.connections.keys()) {
			ws.close(1001, "Server shutting down");
		}
		this.wss.close();
	}

	private handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void {
		const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
		if (pathname !== PRIORITY_SUPPORT_WS_PATH) {
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
		const conn: SupportConnection = { authenticated: false, alive: true };
		this.connections.set(ws, conn);

		const authTimer = setTimeout(() => {
			if (!conn.authenticated) {
				ws.close(CLOSE_UNAUTHORIZED, "Authentication timed out");
			}
		}, AUTH_TIMEOUT_MS);

		ws.on("pong", () => {
			conn.alive = true;
		});

		ws.on("message", (raw) => {
			void this.handleClientMessage(ws, conn, raw, authTimer);
		});

		ws.on("close", () => {
			clearTimeout(authTimer);
			this.connections.delete(ws);
			if (this.authenticatedCount() === 0) {
				this.stopSyncLoop();
			}
		});
	}

	private authenticatedCount(): number {
		let count = 0;
		for (const conn of this.connections.values()) {
			if (conn.authenticated) count++;
		}
		return count;
	}

	private sendJson(ws: WebSocket, payload: unknown): void {
		if (ws.readyState === WebSocket.OPEN) {
			ws.send(JSON.stringify(payload));
		}
	}

	broadcastClosed(reason: "agent" | "user" = "agent"): void {
		this.currentRoom = null;
		this.lastSnapshotJson = JSON.stringify({ room: null, messages: [] });
		this.disconnectUpstreamRealtime();
		for (const [clientWs, clientConn] of this.connections.entries()) {
			if (clientConn.authenticated) {
				this.sendJson(clientWs, { type: "closed", room: null, reason });
			}
		}
	}

	broadcastMessage(
		room: { rid: string; open: boolean } | null,
		message: SupportChatMessage,
		realtime?: SupportRealtimeConfig | null,
	): void {
		if (room) {
			this.currentRoom = room;
		}
		if (realtime) {
			this.ensureUpstreamRealtime(room, realtime);
		}
		for (const [clientWs, clientConn] of this.connections.entries()) {
			if (clientConn.authenticated) {
				this.sendJson(clientWs, { type: "message", room, message });
			}
		}
	}

	private normalizeUpstreamAttachmentUrl(rawUrl: string): string {
		if (/^https?:\/\//i.test(rawUrl)) {
			try {
				const parsed = new URL(rawUrl);
				if (parsed.pathname.startsWith("/file-upload/")) {
					return `${parsed.pathname}${parsed.search}`;
				}
			} catch {
				// keep rawUrl
			}
			return rawUrl;
		}
		return rawUrl.startsWith("/") ? rawUrl : `/${rawUrl}`;
	}

	private mapUpstreamMessage(raw: Record<string, unknown>, visitorToken: string): SupportChatMessage | null {
		const rawAttachments = Array.isArray(raw.attachments) ? (raw.attachments as Record<string, unknown>[]) : [];
		const attachments: SupportChatAttachment[] = [];
		for (const att of rawAttachments) {
			const rawUrl = typeof att.image_url === "string"
				? att.image_url
				: typeof att.title_link === "string"
					? att.title_link
					: "";
			if (!rawUrl.trim()) continue;
			attachments.push({
				name: typeof att.title === "string" && att.title.trim() ? att.title : "attachment",
				url: this.normalizeUpstreamAttachmentUrl(rawUrl.trim()),
				contentType: typeof att.image_type === "string" ? att.image_type : undefined,
			});
		}

		const text = typeof raw.msg === "string" ? raw.msg : "";
		if (!text.trim() && attachments.length === 0) {
			return null;
		}

		const token = typeof raw.token === "string" ? raw.token : "";
		const isCustomer = Boolean(token && token === visitorToken);
		const user = raw.u && typeof raw.u === "object" ? (raw.u as Record<string, unknown>) : undefined;
		const agentName = (typeof user?.name === "string" && user.name) || (typeof user?.username === "string" && user.username) || "Flixer Support";

		let timestamp = new Date().toISOString();
		if (typeof raw.ts === "string") {
			timestamp = raw.ts;
		} else if (raw.ts && typeof raw.ts === "object" && typeof (raw.ts as { $date?: unknown }).$date === "number") {
			timestamp = new Date((raw.ts as { $date: number }).$date).toISOString();
		}

		const id = typeof raw._id === "string" && raw._id ? raw._id : `${timestamp}-${Math.random().toString(36).slice(2, 8)}`;
		return {
			id,
			sender: isCustomer ? "customer" : "agent",
			senderName: isCustomer ? "You" : agentName,
			text,
			timestamp,
			...(attachments.length > 0 ? { attachments } : {}),
		};
	}

	private disconnectUpstreamRealtime(): void {
		if (this.upstreamReconnectTimer) {
			clearTimeout(this.upstreamReconnectTimer);
			this.upstreamReconnectTimer = undefined;
		}
		if (this.upstreamWs) {
			this.upstreamWs.removeAllListeners();
			if (this.upstreamWs.readyState === WebSocket.OPEN || this.upstreamWs.readyState === WebSocket.CONNECTING) {
				this.upstreamWs.close();
			}
			this.upstreamWs = undefined;
		}
		this.upstreamConfig = undefined;
	}

	private ensureUpstreamRealtime(room: { rid: string; open: boolean } | null, realtime?: SupportRealtimeConfig | null): void {
		if (room) {
			this.currentRoom = room;
		}
		if (!realtime || this.authenticatedCount() === 0) {
			return;
		}
		const sameTarget = this.upstreamConfig
			&& this.upstreamConfig.wsUrl === realtime.wsUrl
			&& this.upstreamConfig.rid === realtime.rid
			&& this.upstreamConfig.visitorToken === realtime.visitorToken;
		if (sameTarget && this.upstreamWs && (this.upstreamWs.readyState === WebSocket.OPEN || this.upstreamWs.readyState === WebSocket.CONNECTING)) {
			return;
		}

		this.disconnectUpstreamRealtime();
		this.upstreamConfig = realtime;
		this.connectUpstreamSocket(realtime);
	}

	private connectUpstreamSocket(config: SupportRealtimeConfig): void {
		if (this.authenticatedCount() === 0) return;

		const ws = new WebSocket(config.wsUrl);
		this.upstreamWs = ws;

		ws.on("open", () => {
			ws.send(JSON.stringify({ msg: "connect", version: "1", support: ["1", "pre2", "pre1"] }));
		});

		ws.on("message", (raw) => {
			let msg: {
				msg?: string;
				collection?: string;
				fields?: { args?: unknown[] };
			};
			try {
				msg = JSON.parse(raw.toString()) as typeof msg;
			} catch {
				return;
			}

			if (msg.msg === "ping") {
				ws.send(JSON.stringify({ msg: "pong" }));
				return;
			}

			if (msg.msg === "connected") {
				ws.send(JSON.stringify({
					msg: "sub",
					id: "livechat-room-sub",
					name: "stream-room-messages",
					params: [config.rid, { useCollection: false, args: [{ visitorToken: config.visitorToken }] }],
				}));
				return;
			}

			if (msg.msg === "changed" && msg.collection === "stream-room-messages" && Array.isArray(msg.fields?.args)) {
				for (const item of msg.fields.args) {
					if (!item || typeof item !== "object") continue;
					const raw = item as Record<string, unknown>;
					if (raw.t === "livechat-close") {
						this.broadcastClosed("agent");
						return;
					}
					const mapped = this.mapUpstreamMessage(raw, config.visitorToken);
					if (mapped) {
						this.broadcastMessage(this.currentRoom ?? { rid: config.rid, open: true }, mapped);
					}
				}
			}
		});

		ws.on("error", () => {
			// Reconnect is handled in close listener
		});

		ws.on("close", () => {
			if (this.upstreamWs === ws) {
				this.upstreamWs = undefined;
			}
			if (this.authenticatedCount() > 0 && this.upstreamConfig === config && !this.upstreamReconnectTimer) {
				this.upstreamReconnectTimer = setTimeout(() => {
					this.upstreamReconnectTimer = undefined;
					if (this.authenticatedCount() > 0 && this.upstreamConfig === config) {
						this.connectUpstreamSocket(config);
					}
				}, UPSTREAM_RECONNECT_MS);
				this.upstreamReconnectTimer.unref();
			}
		});
	}

	private broadcastState(state: SupportChatState): void {
		const serialized = JSON.stringify({ room: state.room, messages: state.messages });
		if (serialized === this.lastSnapshotJson) return;
		this.lastSnapshotJson = serialized;
		for (const [ws, conn] of this.connections.entries()) {
			if (conn.authenticated) {
				this.sendJson(ws, { type: "state", room: state.room, messages: state.messages });
			}
		}
	}

	private startSyncLoop(): void {
		if (this.syncTimer) return;
		this.syncTimer = setInterval(() => {
			void this.syncNow();
		}, SYNC_INTERVAL_MS);
		this.syncTimer.unref();
	}

	private stopSyncLoop(): void {
		if (this.syncTimer) {
			clearInterval(this.syncTimer);
			this.syncTimer = undefined;
		}
		this.disconnectUpstreamRealtime();
	}

	private async syncNow(): Promise<void> {
		if (this.authenticatedCount() === 0) {
			this.stopSyncLoop();
			return;
		}
		try {
			const state = await this.prioritySupport.getMessages();
			this.ensureUpstreamRealtime(state.room, state.realtime);
			this.broadcastState(state);
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : "Could not sync Priority Support.";
			for (const [ws, conn] of this.connections.entries()) {
				if (conn.authenticated) {
					this.sendJson(ws, { type: "error", message });
				}
			}
		}
	}

	private async handleClientMessage(
		ws: WebSocket,
		conn: SupportConnection,
		raw: RawData,
		authTimer: NodeJS.Timeout,
	): Promise<void> {
		let msg: { type?: unknown; token?: unknown; message?: unknown };
		try {
			msg = JSON.parse(raw.toString()) as { type?: unknown; token?: unknown; message?: unknown };
		} catch {
			return;
		}

		if (!conn.authenticated) {
			if (msg.type !== "auth" || typeof msg.token !== "string" || !msg.token) {
				ws.close(CLOSE_UNAUTHORIZED, "Authentication required");
				return;
			}
			try {
				await this.authService.requireAdminSession(`Bearer ${msg.token}`);
				const state = await this.prioritySupport.getMessages();
				conn.authenticated = true;
				clearTimeout(authTimer);
				this.lastSnapshotJson = JSON.stringify({ room: state.room, messages: state.messages });
				this.sendJson(ws, { type: "ready", room: state.room, messages: state.messages });
				this.ensureUpstreamRealtime(state.room, state.realtime);
				this.startSyncLoop();
			} catch (error: unknown) {
				const reason = error instanceof Error ? error.message : "Unauthorized";
				ws.close(closeCodeFor(error), reason.slice(0, 120));
			}
			return;
		}

		if (msg.type === "send" && typeof msg.message === "string") {
			try {
				const result = await this.prioritySupport.sendMessage(msg.message);
				this.broadcastMessage(result.room, result.message, result.realtime);
			} catch (error: unknown) {
				this.sendJson(ws, {
					type: "error",
					message: error instanceof Error ? error.message : "Could not send message.",
				});
			}
		}
	}

	private pingClients(): void {
		for (const [ws, conn] of this.connections.entries()) {
			if (!conn.alive) {
				ws.terminate();
				this.connections.delete(ws);
				continue;
			}
			conn.alive = false;
			ws.ping();
		}
	}
}
