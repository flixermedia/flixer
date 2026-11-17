import { describe, expect, it, vi } from "vitest";
import type { DataSource } from "typeorm";
import { PluginStreamerService } from "./pluginStreamerService.js";

describe("PluginStreamerService", () => {
	it("only invokes approved hooks and preserves the core decision on failures", async () => {
		const plugin = { pluginId: "plugin.example", manifest: { targets: { "flixer-streamer": { entry: "streamer.wasm" } }, capabilities: ["streamer.playback.authorize"], permissions: ["streamer.playback.authorize"] }, approvedPermissions: ["streamer.playback.authorize"] };
		const dataSource = { getRepository: vi.fn(() => ({ find: vi.fn().mockResolvedValue([plugin]) })) } as unknown as DataSource;
		const runtime = { execute: vi.fn().mockRejectedValueOnce(new Error("unavailable")).mockResolvedValueOnce({ allowed: false }) };
		const service = new PluginStreamerService(dataSource, runtime as never);
		const input = { userId: "user", itemId: "item", sessionId: "session" };
		await expect(service.available()).resolves.toEqual(["authorize"]);
		await expect(service.run("authorize", input)).resolves.toEqual({ allowed: true });
		await expect(service.run("authorize", input)).resolves.toEqual({ allowed: false });
		plugin.approvedPermissions = [];
		await expect(service.available()).resolves.toEqual([]);
		await expect(service.run("authorize", input)).resolves.toEqual({ allowed: true });
		expect(runtime.execute).toHaveBeenCalledTimes(2);
	});

	it("accepts only bounded processing and manifest values", async () => {
		const plugin = { pluginId: "plugin.example", manifest: { targets: { "flixer-streamer": { entry: "streamer.wasm" } }, capabilities: ["streamer.processing", "streamer.manifest"], permissions: ["streamer.processing", "streamer.manifest"] }, approvedPermissions: ["streamer.processing", "streamer.manifest"] };
		const dataSource = { getRepository: vi.fn(() => ({ find: vi.fn().mockResolvedValue([plugin]) })) } as unknown as DataSource;
		const runtime = { execute: vi.fn().mockResolvedValueOnce({ maxHeight: 9999 }).mockResolvedValueOnce({ startSeconds: 1000 }) };
		const service = new PluginStreamerService(dataSource, runtime as never);
		const input = { userId: "user", itemId: "item", sessionId: "session", durationSeconds: 60 };
		await expect(service.run("processing", input)).resolves.toEqual({ maxHeight: null });
		await expect(service.run("manifest", input)).resolves.toEqual({ startSeconds: null });
	});
});