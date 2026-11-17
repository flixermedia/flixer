import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { WebSocket } from "ws";
import { afterEach, describe, expect, it } from "vitest";
import { PlaybackRemoteSocketServer } from "./playbackRemoteSocketServer.ts";

interface Client {
	ws: WebSocket;
	messages: Array<Record<string, unknown>>;
}

describe("PlaybackRemoteSocketServer", () => {
	let server: Server;
	let sockets: PlaybackRemoteSocketServer;

	afterEach(() => {
		sockets.close();
		server.close();
	});

	async function setup() {
		server = createServer();
		sockets = new PlaybackRemoteSocketServer(async (token) => {
			if (token === "revoked" || token === "bad") throw new Error("invalid session");
			return token.startsWith("alice") ? "alice" : "bob";
		});
		sockets.attach(server);
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
		return (server.address() as AddressInfo).port;
	}

	async function connect(port: number, token: string): Promise<Client> {
		const ws = new WebSocket(`ws://127.0.0.1:${port}/api/playback/remote`);
		const messages: Array<Record<string, unknown>> = [];
		ws.on("message", (raw) => messages.push(JSON.parse(raw.toString()) as Record<string, unknown>));
		await new Promise<void>((resolve, reject) => {
			ws.once("open", resolve);
			ws.once("error", reject);
		});
		ws.send(JSON.stringify({ type: "auth", token }));
		await waitFor(() => messages.some((message) => message.type === "ready"));
		return { ws, messages };
	}

	async function waitFor(predicate: () => boolean): Promise<void> {
		const start = Date.now();
		while (!predicate()) {
			if (Date.now() - start > 2_000) throw new Error("Timed out waiting for WebSocket message");
			await new Promise((resolve) => setTimeout(resolve, 10));
		}
	}

	function publish(client: Client, clientId = "device-alice") {
		client.ws.send(JSON.stringify({
			type: "state", clientId, deviceName: "Living room", player: {
				kind: "video", title: "A film", itemId: "media-1", playing: true, position: 15, duration: 100,
			},
		}));
	}

	function publishIdle(client: Client, clientId = "device-idle") {
		client.ws.send(JSON.stringify({ type: "state", clientId, deviceName: "Bedroom TV", player: null }));
	}

	it("lists and routes commands to another client owned by the same user", async () => {
		const port = await setup();
		const target = await connect(port, "alice-session-target");
		const remote = await connect(port, "alice-session-remote");
		publish(target);
		await waitFor(() => remote.messages.some((message) => message.type === "devices" && Array.isArray(message.devices) && message.devices.length === 1));
		remote.ws.send(JSON.stringify({ type: "command", requestId: "request-1", targetClientId: "device-alice", command: { action: "seek", position: 42 } }));
		await waitFor(() => target.messages.some((message) => message.type === "command"));
		expect(target.messages.at(-1)).toMatchObject({ type: "command", requestId: "request-1", command: { action: "seek", position: 42 } });
		expect(remote.messages.at(-1)).toMatchObject({ type: "command-result", requestId: "request-1", ok: true });
		for (const [requestId, command] of [
			["volume-1", { action: "volume", volume: 0.4, muted: false }],
			["audio-1", { action: "audio-track", index: 2 }],
			["subtitle-1", { action: "subtitle", id: "sub-1" }],
			["skip-1", { action: "skip" }],
		] as const) {
			const previous = target.messages.filter((message) => message.type === "command").length;
			remote.ws.send(JSON.stringify({ type: "command", requestId, targetClientId: "device-alice", command }));
			await waitFor(() => target.messages.filter((message) => message.type === "command").length > previous);
			expect(target.messages.at(-1)).toMatchObject({ type: "command", requestId, command });
		}
		remote.ws.send(JSON.stringify({ type: "command", requestId: "cast-1", targetClientId: "device-alice", command: { action: "play-item", item: { kind: "video", itemId: "media-2", title: "Another film" } } }));
		await waitFor(() => target.messages.some((message) => message.type === "command" && message.requestId === "cast-1"));
		expect(target.messages.at(-1)).toMatchObject({ type: "command", requestId: "cast-1", command: { action: "play-item", item: { kind: "video", itemId: "media-2" } } });
		target.ws.close();
		remote.ws.close();
	});

	it("does not route commands across accounts or to unknown devices", async () => {
		const port = await setup();
		const target = await connect(port, "bob-session");
		const remote = await connect(port, "alice-session-remote");
		publish(target, "device-bob");
		remote.ws.send(JSON.stringify({ type: "command", requestId: "request-2", targetClientId: "device-bob", command: { action: "pause" } }));
		await waitFor(() => remote.messages.some((message) => message.type === "command-result"));
		expect(remote.messages.at(-1)).toMatchObject({ type: "command-result", requestId: "request-2", ok: false, reason: "offline" });
		expect(target.messages.some((message) => message.type === "command")).toBe(false);
		target.ws.close();
		remote.ws.close();
	});

	it("casts a validated audio queue to the selected same-account player", async () => {
		const port = await setup();
		const target = await connect(port, "alice-session-target");
		const remote = await connect(port, "alice-session-remote");
		publish(target);
		await waitFor(() => remote.messages.some((message) => message.type === "devices" && Array.isArray(message.devices) && message.devices.length === 1));
		const item = {
			kind: "audio",
			startIndex: 0,
			tracks: [{ id: "track-1", title: "A song", artist: "An artist", artistId: null, album: "An album", albumId: "album-1", art: null }],
		};
		remote.ws.send(JSON.stringify({ type: "command", requestId: "cast-audio", targetClientId: "device-alice", command: { action: "play-item", item } }));
		await waitFor(() => target.messages.some((message) => message.type === "command" && message.requestId === "cast-audio"));
		expect(target.messages.at(-1)).toMatchObject({ type: "command", requestId: "cast-audio", command: { action: "play-item", item } });
		target.ws.close();
		remote.ws.close();
	});

	it("allows Cast to an active signed-in browser that is not already playing", async () => {
		const port = await setup();
		const idleDevice = await connect(port, "alice-session-idle");
		const remote = await connect(port, "alice-session-remote");
		publishIdle(idleDevice, "idle-device");
		await waitFor(() => remote.messages.some((message) => message.type === "devices" && Array.isArray(message.devices) && message.devices.some((device) => device.clientId === "idle-device" && device.player === undefined)));
		remote.ws.send(JSON.stringify({ type: "command", requestId: "cast-idle", targetClientId: "idle-device", command: { action: "play-item", item: { kind: "video", itemId: "media-id", title: "A film" } } }));
		await waitFor(() => idleDevice.messages.some((message) => message.type === "command" && message.requestId === "cast-idle"));
		expect(idleDevice.messages.at(-1)).toMatchObject({ type: "command", requestId: "cast-idle", command: { action: "play-item" } });
		idleDevice.ws.close();
		remote.ws.close();
	});

	it("rejects malformed state and commands", async () => {
		const port = await setup();
		const target = await connect(port, "alice-session-target");
		const remote = await connect(port, "alice-session-remote");
		publish(target);
		await waitFor(() => remote.messages.some((message) => message.type === "devices" && Array.isArray(message.devices) && message.devices.length === 1));
		remote.ws.send(JSON.stringify({ type: "command", requestId: "request-3", targetClientId: "device-alice", command: { action: "seek", position: -10 } }));
		remote.ws.send(JSON.stringify({ type: "command", requestId: "request-4", targetClientId: "device-alice", command: { action: "seek", position: 42 } }));
		await waitFor(() => target.messages.some((message) => message.type === "command"));
		expect(target.messages.filter((message) => message.type === "command")).toHaveLength(1);
		target.ws.close();
		remote.ws.close();
	});

	it("relays trickplay previews only to the requesting same-account device", async () => {
		const port = await setup();
		const target = await connect(port, "alice-session-target");
		const remote = await connect(port, "alice-session-remote");
		publish(target);
		remote.ws.send(JSON.stringify({ type: "state", clientId: "remote-device", deviceName: "Remote", player: null }));
		await waitFor(() => target.messages.some((message) => message.type === "devices"));
		remote.ws.send(JSON.stringify({ type: "preview-request", requestId: "preview-1", targetClientId: "device-alice", position: 24 }));
		await waitFor(() => target.messages.some((message) => message.type === "preview-request"));
		expect(target.messages.at(-1)).toMatchObject({ type: "preview-request", requestId: "preview-1", requesterClientId: "remote-device", position: 24 });
		target.ws.send(JSON.stringify({ type: "preview-response", requestId: "preview-1", requesterClientId: "remote-device", dataUrl: "data:image/webp;base64,AAAA" }));
		await waitFor(() => remote.messages.some((message) => message.type === "preview-response"));
		expect(remote.messages.at(-1)).toMatchObject({ type: "preview-response", requestId: "preview-1", dataUrl: "data:image/webp;base64,AAAA" });
		target.ws.close();
		remote.ws.close();
	});
});
