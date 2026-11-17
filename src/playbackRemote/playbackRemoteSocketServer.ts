import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import { CLOSE_UNAUTHORIZED } from "../utils/socketCloseCodes.js";

export const PLAYBACK_REMOTE_PATH = "/api/playback/remote";

const AUTH_TIMEOUT_MS = 5_000;
const HEARTBEAT_INTERVAL_MS = 15_000;
const REVALIDATE_INTERVAL_MS = 30_000;
const PRESENCE_TTL_MS = 10_000;
const MAX_CLIENTS = 500;
const MAX_MESSAGE_BYTES = 256 * 1_024;
const MAX_BUFFERED_BYTES = 512 * 1_024;

type RemoteCommand =
	| { action: "play" | "pause" }
	| { action: "seek"; position: number }
	| { action: "volume"; volume: number; muted: boolean }
	| { action: "audio-track"; index: number }
	| { action: "subtitle"; id: string }
	| { action: "skip" }
	| { action: "play-item"; item: RemoteCastItem };
interface RemoteAudioTrack {
	id: string;
	title: string;
	artist: string | null;
	artistId: string | null;
	album: string | null;
	albumId: string | null;
	art: { itemId: string; index: number; version?: string } | null;
}
type RemoteCastItem =
	| { kind: "video"; itemId: string; title: string; startAt?: number }
	| { kind: "audio"; tracks: RemoteAudioTrack[]; startIndex: number };
interface RemoteTrack { id: string; label: string }
interface RemoteChapter { start: number; title: string }
interface RemoteSegment { start: number; end: number; type: string }
interface RemoteTrickplay {
	manifest: { intervalMs: number; thumbWidth: number; thumbHeight: number; columns: number; rows: number; count: number; sheets: number };
}
interface RemotePlayerState {
	kind: "audio" | "video";
	title: string;
	subtitle?: string;
	itemId?: string;
	playing: boolean;
	position: number;
	duration: number;
	volume?: number;
	muted?: boolean;
	audioTracks?: RemoteTrack[];
	audioTrackIndex?: number | null;
	subtitles?: RemoteTrack[];
	subtitleId?: string;
	chapters?: RemoteChapter[];
	segments?: RemoteSegment[];
	trickplay?: RemoteTrickplay;
}
interface RemoteDevice {
	clientId: string;
	deviceName: string;
	player?: RemotePlayerState;
	updatedAt: number;
}

type PlaybackRemoteAuthenticator = (token: string) => Promise<string>;

interface Connection {
	token?: string;
	userId?: string;
	clientId?: string;
	deviceName?: string;
	player?: RemotePlayerState;
	updatedAt: number;
	alive: boolean;
}

export class PlaybackRemoteSocketServer {
	private readonly wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });
	private readonly connections = new Map<WebSocket, Connection>();
	private server?: Server;
	private heartbeat?: NodeJS.Timeout;
	private revalidation?: NodeJS.Timeout;
	private readonly onUpgrade = (request: IncomingMessage, socket: Duplex, head: Buffer) => this.handleUpgrade(request, socket, head);

	constructor(private readonly authenticate: PlaybackRemoteAuthenticator) {}

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
		for (const ws of this.connections.keys()) ws.close(1001, "Server shutting down");
		this.wss.close();
	}

	private handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void {
		if (new URL(request.url ?? "/", "http://localhost").pathname !== PLAYBACK_REMOTE_PATH) return;
		if (this.connections.size >= MAX_CLIENTS) {
			socket.write("HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n");
			socket.destroy();
			return;
		}
		this.wss.handleUpgrade(request, socket, head, (ws) => this.onConnection(ws));
	}

	private onConnection(ws: WebSocket): void {
		const connection: Connection = { alive: true, updatedAt: 0 };
		this.connections.set(ws, connection);
		const authTimeout = setTimeout(() => {
			if (!connection.userId) ws.close(CLOSE_UNAUTHORIZED, "Authentication timed out");
		}, AUTH_TIMEOUT_MS);
		ws.on("pong", () => { connection.alive = true; });
		ws.on("message", (raw) => void this.onMessage(ws, connection, raw));
		ws.on("error", () => ws.terminate());
		ws.on("close", () => {
			clearTimeout(authTimeout);
			this.connections.delete(ws);
			if (connection.userId) this.broadcastDevices(connection.userId);
		});
	}

	private async onMessage(ws: WebSocket, connection: Connection, raw: RawData): Promise<void> {
		const message = parseMessage(raw);
		if (!message) {
			ws.close(CLOSE_UNAUTHORIZED, "Invalid message");
			return;
		}
		if (!connection.userId) {
			if (message.type !== "auth" || typeof message.token !== "string") {
				ws.close(CLOSE_UNAUTHORIZED, "Expected an auth message");
				return;
			}
			try {
				connection.userId = await this.authenticate(message.token);
				connection.token = message.token;
			} catch {
				ws.close(CLOSE_UNAUTHORIZED, "Sign in to control your devices");
				return;
			}
			if (ws.readyState !== WebSocket.OPEN) return;
			this.send(ws, { type: "ready", clientId: typeof message.clientId === "string" && isClientId(message.clientId) ? message.clientId : null });
			this.send(ws, { type: "devices", devices: this.devicesFor(connection.userId) });
			return;
		}
		if (message.type === "state") {
			if (typeof message.clientId !== "string" || !isClientId(message.clientId) || typeof message.deviceName !== "string") return;
			connection.clientId = message.clientId;
			connection.deviceName = message.deviceName.slice(0, 64);
			connection.player = isPlayerState(message.player) ? message.player : undefined;
			connection.updatedAt = Date.now();
			for (const [otherWs, other] of this.connections) {
				if (otherWs !== ws && other.userId === connection.userId && other.clientId === connection.clientId) otherWs.close(4000, "Device connection replaced");
			}
			this.broadcastDevices(connection.userId);
		} else if (message.type === "command") {
			if (!(await this.revalidate(ws, connection))) return;
			if (typeof message.targetClientId !== "string" || !isClientId(message.targetClientId) || typeof message.requestId !== "string" || !/^[\w-]{1,64}$/.test(message.requestId)) return;
			const command = parseCommand(message.command);
			if (!command) return;
			const target = [...this.connections].find(([, candidate]) => candidate.userId === connection.userId && candidate.clientId === message.targetClientId && (command.action === "play-item" ? this.isActive(candidate) : this.hasPresence(candidate)));
			if (!target || !(await this.revalidate(target[0], target[1]))) {
				this.send(ws, { type: "command-result", requestId: message.requestId, ok: false, reason: "offline" });
				return;
			}
			this.send(target[0], { type: "command", requestId: message.requestId, command });
			this.send(ws, { type: "command-result", requestId: message.requestId, ok: true });
		} else if (message.type === "preview-request") {
			if (!(await this.revalidate(ws, connection))) return;
			if (typeof message.targetClientId !== "string" || !isClientId(message.targetClientId) || typeof message.requestId !== "string" || !/^[\w-]{1,64}$/.test(message.requestId) || typeof message.position !== "number" || !Number.isFinite(message.position) || message.position < 0 || message.position > 86_400 || !connection.clientId) return;
			const target = [...this.connections].find(([, candidate]) => candidate.userId === connection.userId && candidate.clientId === message.targetClientId && this.hasPresence(candidate));
			if (!target) return;
			this.send(target[0], { type: "preview-request", requestId: message.requestId, position: message.position, requesterClientId: connection.clientId });
		} else if (message.type === "preview-response") {
			if (!(await this.revalidate(ws, connection))) return;
			if (typeof message.requestId !== "string" || !/^[\w-]{1,64}$/.test(message.requestId) || typeof message.requesterClientId !== "string" || !isClientId(message.requesterClientId) || typeof message.dataUrl !== "string" || message.dataUrl.length > 32_000 || !/^data:image\/(?:jpeg|webp);base64,/.test(message.dataUrl)) return;
			const requester = [...this.connections].find(([, candidate]) => candidate.userId === connection.userId && candidate.clientId === message.requesterClientId);
			if (requester) this.send(requester[0], { type: "preview-response", requestId: message.requestId, dataUrl: message.dataUrl });
		}
	}

	private hasPresence(connection: Connection): boolean {
		return Boolean(connection.player && Date.now() - connection.updatedAt < PRESENCE_TTL_MS);
	}

	private isActive(connection: Connection): boolean {
		return Boolean(connection.clientId && Date.now() - connection.updatedAt < PRESENCE_TTL_MS);
	}

	private devicesFor(userId: string): RemoteDevice[] {
		const devices = new Map<string, RemoteDevice>();
		for (const connection of this.connections.values()) {
			if (connection.userId !== userId || !connection.clientId || !connection.deviceName || !this.isActive(connection)) continue;
			devices.set(connection.clientId, {
				clientId: connection.clientId,
				deviceName: connection.deviceName,
				...(connection.player ? { player: connection.player } : {}),
				updatedAt: connection.updatedAt,
			});
		}
		return [...devices.values()];
	}

	private broadcastDevices(userId: string): void {
		const message = { type: "devices", devices: this.devicesFor(userId) };
		for (const [ws, connection] of this.connections) {
			if (connection.userId === userId) this.send(ws, message);
		}
	}

	private async revalidate(ws: WebSocket, connection: Connection): Promise<boolean> {
		if (!connection.token || !connection.userId || ws.readyState !== WebSocket.OPEN) return false;
		try {
			if (await this.authenticate(connection.token) === connection.userId && ws.readyState === WebSocket.OPEN) return true;
		} catch {}
		ws.close(CLOSE_UNAUTHORIZED, "Session is no longer active");
		return false;
	}

	private pingClients(): void {
		for (const [ws, connection] of this.connections) {
			if (!connection.alive) {
				ws.terminate();
				continue;
			}
			connection.alive = false;
			ws.ping();
			if (connection.userId && connection.player && !this.hasPresence(connection)) {
				connection.player = undefined;
				this.broadcastDevices(connection.userId);
			}
		}
	}

	private async revalidateClients(): Promise<void> {
		await Promise.all([...this.connections].map(([ws, connection]) => connection.token ? this.revalidate(ws, connection) : Promise.resolve(false)));
	}

	private send(ws: WebSocket, message: unknown): void {
		if (ws.readyState !== WebSocket.OPEN) return;
		if (ws.bufferedAmount > MAX_BUFFERED_BYTES) {
			ws.close(1013, "Client is too slow");
			return;
		}
		ws.send(JSON.stringify(message));
	}
}

interface ClientMessage {
	type?: unknown;
	token?: unknown;
	clientId?: unknown;
	deviceName?: unknown;
	player?: unknown;
	targetClientId?: unknown;
	requestId?: unknown;
	command?: unknown;
	position?: unknown;
	requesterClientId?: unknown;
	dataUrl?: unknown;
}

function parseMessage(raw: RawData): ClientMessage | null {
	try {
		const message = JSON.parse(raw.toString()) as unknown;
		return typeof message === "object" && message !== null ? message as ClientMessage : null;
	} catch {
		return null;
	}
}

function isClientId(value: string): boolean {
	return /^[\w-]{8,64}$/.test(value);
}

function isPlayerState(value: unknown): value is RemotePlayerState {
	if (typeof value !== "object" || value === null) return false;
	const state = value as Record<string, unknown>;
	return (state.kind === "audio" || state.kind === "video") && typeof state.title === "string" && state.title.length > 0 && state.title.length <= 200 &&
		(state.subtitle === undefined || typeof state.subtitle === "string" && state.subtitle.length <= 200) &&
		(state.itemId === undefined || typeof state.itemId === "string" && state.itemId.length <= 128) &&
		typeof state.playing === "boolean" && typeof state.position === "number" && Number.isFinite(state.position) && state.position >= 0 && state.position <= 86_400 &&
		typeof state.duration === "number" && Number.isFinite(state.duration) && state.duration >= 0 && state.duration <= 86_400 &&
		(state.volume === undefined || typeof state.volume === "number" && Number.isFinite(state.volume) && state.volume >= 0 && state.volume <= 1) &&
		(state.muted === undefined || typeof state.muted === "boolean") &&
		(state.audioTrackIndex === undefined || state.audioTrackIndex === null || Number.isInteger(state.audioTrackIndex) && state.audioTrackIndex >= 0 && state.audioTrackIndex < 32) &&
		isTracks(state.audioTracks) && isTracks(state.subtitles) &&
		(state.subtitleId === undefined || typeof state.subtitleId === "string" && state.subtitleId.length <= 128) &&
		isChapters(state.chapters) && isSegments(state.segments) && isTrickplay(state.trickplay);
}

function parseCommand(value: unknown): RemoteCommand | null {
	if (typeof value !== "object" || value === null) return null;
	const command = value as Record<string, unknown>;
	if (command.action === "play" || command.action === "pause") return { action: command.action };
	if (command.action === "seek" && typeof command.position === "number" && Number.isFinite(command.position) && command.position >= 0 && command.position <= 86_400) {
		return { action: "seek", position: command.position };
	}
	if (command.action === "volume" && typeof command.volume === "number" && Number.isFinite(command.volume) && command.volume >= 0 && command.volume <= 1 && typeof command.muted === "boolean") return { action: "volume", volume: command.volume, muted: command.muted };
	if (command.action === "audio-track" && Number.isInteger(command.index) && typeof command.index === "number" && command.index >= 0 && command.index < 32) return { action: "audio-track", index: command.index };
	if (command.action === "subtitle" && typeof command.id === "string" && command.id.length <= 128) return { action: "subtitle", id: command.id };
	if (command.action === "skip") return { action: "skip" };
	if (command.action === "play-item") {
		const item = parseCastItem(command.item);
		if (item) return { action: "play-item", item };
	}
	return null;
}

function parseCastItem(value: unknown): RemoteCastItem | null {
	if (typeof value !== "object" || value === null) return null;
	const item = value as Record<string, unknown>;
	if (item.kind === "video" && typeof item.itemId === "string" && item.itemId.length <= 128 && typeof item.title === "string" && item.title.length > 0 && item.title.length <= 200 && (item.startAt === undefined || typeof item.startAt === "number" && Number.isFinite(item.startAt) && item.startAt >= 0 && item.startAt <= 86_400)) {
		return { kind: "video", itemId: item.itemId, title: item.title, ...(typeof item.startAt === "number" ? { startAt: item.startAt } : {}) };
	}
	if (item.kind !== "audio" || !Array.isArray(item.tracks) || item.tracks.length === 0 || item.tracks.length > 200 || typeof item.startIndex !== "number" || !Number.isInteger(item.startIndex) || item.startIndex < 0 || item.startIndex >= item.tracks.length) return null;
	const tracks = item.tracks;
	if (!tracks.every((entry) => {
		if (typeof entry !== "object" || entry === null) return false;
		const track = entry as Record<string, unknown>;
		return typeof track.id === "string" && track.id.length <= 128 && typeof track.title === "string" && track.title.length > 0 && track.title.length <= 200 &&
			(track.artist === null || typeof track.artist === "string" && track.artist.length <= 200) &&
			(track.artistId === null || typeof track.artistId === "string" && track.artistId.length <= 128) &&
			(track.album === null || typeof track.album === "string" && track.album.length <= 200) &&
			(track.albumId === null || typeof track.albumId === "string" && track.albumId.length <= 128) &&
			(track.art === null || typeof track.art === "object" && track.art !== null && typeof (track.art as Record<string, unknown>).itemId === "string" && typeof (track.art as Record<string, unknown>).index === "number");
	})) return null;
	return { kind: "audio", tracks: tracks as RemoteAudioTrack[], startIndex: item.startIndex };
}

function isTracks(value: unknown): value is RemoteTrack[] | undefined {
	return value === undefined || Array.isArray(value) && value.length <= 32 && value.every((track) => typeof track?.id === "string" && track.id.length <= 128 && typeof track.label === "string" && track.label.length <= 120);
}

function isChapters(value: unknown): value is RemoteChapter[] | undefined {
	return value === undefined || Array.isArray(value) && value.length <= 100 && value.every((chapter) => Number.isFinite(chapter?.start) && chapter.start >= 0 && chapter.start <= 86_400 && typeof chapter.title === "string" && chapter.title.length <= 120);
}

function isSegments(value: unknown): value is RemoteSegment[] | undefined {
	return value === undefined || Array.isArray(value) && value.length <= 100 && value.every((segment) => Number.isFinite(segment?.start) && segment.start >= 0 && Number.isFinite(segment.end) && segment.end > segment.start && segment.end <= 86_400 && typeof segment.type === "string" && segment.type.length <= 32);
}

function isTrickplay(value: unknown): value is RemoteTrickplay | undefined {
	if (value === undefined) return true;
	if (typeof value !== "object" || value === null) return false;
	const trickplay = value as Record<string, unknown>;
	if (typeof trickplay.manifest !== "object" || trickplay.manifest === null) return false;
	const manifest = trickplay.manifest as Record<string, unknown>;
	return ["intervalMs", "thumbWidth", "thumbHeight", "columns", "rows", "count", "sheets"].every((key) => typeof manifest[key] === "number" && Number.isFinite(manifest[key]) && manifest[key] > 0) &&
		Number(manifest.sheets) <= 1_000 && Number(manifest.count) <= 100_000;
}