import { afterEach, describe, expect, it, vi } from "vitest";
import { AppConfig, setAppConfig } from "../../config/store/appConfig.js";
import { UpdateService } from "./updateService.js";

describe("additional update components", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		vi.unstubAllEnvs();
		setAppConfig(undefined);
	});

	it("detects installed and available AI and Logger releases", async () => {
		setAppConfig(new AppConfig(null));
		vi.stubEnv("FLIXER_AI_URL", "http://127.0.0.1:8094");
		vi.stubEnv("FLIXER_LOGGER_LOCAL_ENDPOINT", "http://127.0.0.1:8098");
		vi.stubGlobal("fetch", vi.fn(async (url: string) => {
			if (url.includes("/healthz") && url.includes("8094")) return Response.json({ version: "1.1.0" });
			if (url.includes("/api/health/live")) return Response.json({ version: "v2.0.0" });
			if (url.includes("flixer-ai/releases/latest")) return Response.json({ tag_name: "v1.2.0" });
			if (url.includes("flixer-logger/releases/latest")) return Response.json({ tag_name: "v2.1.0" });
			return Response.json({});
		}));
		const repository = { findOneBy: vi.fn().mockResolvedValue(null), update: vi.fn().mockResolvedValue(undefined) };
		const updater = { token: () => "token", call: vi.fn(async (_path: string, _init?: { method?: string; body?: string }) => Response.json({ mode: "compose", state: { run: null } })) };
		const service = new UpdateService({ getRepository: () => repository } as never, {} as never, updater as never);
		const status = await service.status();
		expect(status.components).toEqual(expect.arrayContaining([
			expect.objectContaining({ id: "ai", installed: "1.1.0", latest: "1.2.0", updateAvailable: true }),
			expect.objectContaining({ id: "logger", installed: "v2.0.0", latest: "2.1.0", updateAvailable: true }),
		]));
		vi.stubEnv("DATABASE_URL", "postgres://test:test@localhost/test");
		await service.apply();
		const request = updater.call.mock.calls.find((call) => call[0] === "/v1/update");
		expect(request).toBeDefined();
		expect(JSON.parse(request![1]!.body!)).toMatchObject({
			targets: { ai: "1.2.0", logger: "2.1.0" },
			current: { ai: "1.1.0", logger: "2.0.0" },
		});
	});

	it("does not mistake an external Logger for the bundled Compose service", async () => {
		setAppConfig(new AppConfig(null));
		vi.stubEnv("FLIXER_LOGGER_URL", "https://external-logger.example");
		vi.stubEnv("FLIXER_LOGGER_LOCAL_ENDPOINT", "");
		vi.stubEnv("FLIXER_LOGGER_LOCAL_OWNER_FILE", "");
		const fetch = vi.fn(async (_url: string) => Response.json({ version: "1.0.0" }));
		vi.stubGlobal("fetch", fetch);
		const repository = { findOneBy: vi.fn().mockResolvedValue(null), update: vi.fn().mockResolvedValue(undefined) };
		const updater = { token: () => undefined };
		const service = new UpdateService({ getRepository: () => repository } as never, {} as never, updater as never);
		const status = await service.status();
		expect(status.components).toContainEqual(expect.objectContaining({ id: "logger", installed: null, reachable: false }));
		expect(fetch.mock.calls.some((args) => String(args[0]).includes("external-logger.example"))).toBe(false);
	});
});
