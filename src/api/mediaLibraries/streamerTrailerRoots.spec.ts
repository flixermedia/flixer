import { createHash, createHmac } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DataSource } from "typeorm";
import { AppConfig, setAppConfig } from "../../config/store/appConfig.js";
import type { MediaRootsService } from "./mediaRootsService.js";
import { STREAMER_HOOK_CONTEXT, STREAMER_ROOTS_CONTEXT, StreamerRootsController } from "./streamerRootsController.js";

describe("streamer trailer root", () => {
	afterEach(() => {
		setAppConfig(undefined);
		vi.unstubAllEnvs();
		vi.restoreAllMocks();
	});

	it("authenticates the exact streamer hook body", async () => {
		const secret = "streamer-test-secret-not-for-production";
		vi.stubEnv("APP_SECRET", secret);
		setAppConfig(new AppConfig(null));
		const timestamp = String(Math.floor(Date.now() / 1000));
		const body = Buffer.from(JSON.stringify({ hook: "authorize", userId: "user", itemId: "item", sessionId: "session" }));
		const hash = createHash("sha256").update(body).digest("hex");
		const signature = createHmac("sha256", secret).update(`${STREAMER_HOOK_CONTEXT}:${hash}:${timestamp}`).digest("hex");
		const plugins = { run: vi.fn().mockResolvedValue({ allowed: false }) };
		const controller = new StreamerRootsController({} as MediaRootsService, {} as DataSource, plugins as never);
		await expect(controller.pluginHook(body, timestamp, signature)).resolves.toEqual({ allowed: false });
		await expect(controller.pluginHook(Buffer.from("{}"), timestamp, signature)).rejects.toThrow("Invalid streamer signature");
		expect(plugins.run).toHaveBeenCalledOnce();
	});

	it("exposes trailer storage to the signed streamer without adding a user-facing library root", async () => {
		const directory = await mkdtemp(join(tmpdir(), "flixer-root-test-"));
		try {
			const secret = "trailer-test-secret-not-for-production";
			vi.stubEnv("APP_SECRET", secret);
			vi.stubEnv("DATA_PATH", directory);
			setAppConfig(new AppConfig(null));
			const timestamp = String(Math.floor(Date.now() / 1000));
			const signature = createHmac("sha256", secret).update(`${STREAMER_ROOTS_CONTEXT}:${timestamp}`).digest("hex");
			const roots = { list: () => [{ id: "media", name: "Media", path: "/media" }] } as unknown as MediaRootsService;
			const controller = new StreamerRootsController(roots, {} as DataSource);
			await expect(controller.list(timestamp, signature)).resolves.toEqual({
				roots: [{ id: "media", path: "/media" }, { id: "flixer-advertisements", path: join(directory, "advertisements") }, { id: "flixer-trailers", path: join(directory, "cache", "trailers") }],
			});
			await expect(controller.list(timestamp, "00")).rejects.toThrow("Invalid streamer signature");

			const blocked = join(directory, "not-a-directory");
			await writeFile(blocked, "file");
			vi.stubEnv("DATA_PATH", blocked);
			const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
			await expect(controller.list(timestamp, signature)).resolves.toEqual({ roots: [{ id: "media", path: "/media" }] });
			expect(log).toHaveBeenCalledTimes(2);
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});
});
