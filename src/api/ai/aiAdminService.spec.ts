import { BadRequest } from "@tsed/exceptions";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DataSource } from "typeorm";
import { AppConfig, setAppConfig } from "../../config/store/appConfig.js";
import { Setting } from "../../entities/setting.entity.js";
import { aiSignature } from "./aiAuth.js";
import { AiAdminService } from "./aiAdminService.js";

describe("AiAdminService", () => {
	const originalSecret = process.env.APP_SECRET;
	const originalUrl = process.env.FLIXER_AI_URL;

	afterEach(() => {
		if (originalSecret === undefined) delete process.env.APP_SECRET;
		else process.env.APP_SECRET = originalSecret;
		if (originalUrl === undefined) delete process.env.FLIXER_AI_URL;
		else process.env.FLIXER_AI_URL = originalUrl;
		vi.unstubAllGlobals();
		setAppConfig(undefined);
	});

	it("persists validated AI controls in the settings store", async () => {
		const settings = [
			{ key: "ai_enabled", value: false },
			{ key: "ai_profile", value: "auto" },
			{ key: "ai_allow_downloads", value: true },
			{ key: "ai_cache_refresh_interval_minutes", value: 10 },
		] as Setting[];
		const repository = {
			findBy: vi.fn(async () => settings),
			findOneBy: vi.fn(async ({ key }: { key: string }) => settings.find((setting) => setting.key === key) ?? null),
			save: vi.fn(async (setting: Setting) => setting),
		};
		const manager = { getRepository: vi.fn(() => repository) };
		const dataSource = {
			getRepository: vi.fn(() => repository),
			transaction: (run: (manager: never) => Promise<void>) => run(manager as never),
		} as unknown as DataSource;
		const service = new AiAdminService(dataSource);

		await expect(
			service.saveConfiguration({
				enabled: true,
				profile: "micro",
				allowDownloads: false,
				cacheRefreshIntervalMinutes: 5,
			}),
		).resolves.toEqual({
			enabled: true,
			profile: "micro",
			allowDownloads: false,
			cacheRefreshIntervalMinutes: 5,
		});
		expect(repository.save).toHaveBeenCalledTimes(4);

		await expect(
			service.saveConfiguration({
				enabled: true,
				profile: "invalid" as "auto",
				allowDownloads: false,
				cacheRefreshIntervalMinutes: 5,
			}),
		).rejects.toThrow(BadRequest);
		await expect(
			service.saveConfiguration({
				enabled: true,
				profile: "auto",
				allowDownloads: true,
				cacheRefreshIntervalMinutes: 1441,
			}),
		).rejects.toThrow(BadRequest);
	});

	it("applies saved runtime settings with the AI service signature", async () => {
		const secret = "test-shared-secret-with-at-least-32-bytes";
		process.env.APP_SECRET = secret;
		process.env.FLIXER_AI_URL = "http://ai:8094";
		setAppConfig(new AppConfig(null));
		const settings = [
			{ key: "ai_enabled", value: false },
			{ key: "ai_profile", value: "auto" },
			{ key: "ai_allow_downloads", value: true },
			{ key: "ai_cache_refresh_interval_minutes", value: 10 },
		] as Setting[];
		const repository = {
			findBy: vi.fn(async () => settings),
			findOneBy: vi.fn(async ({ key }: { key: string }) => settings.find((setting) => setting.key === key) ?? null),
			save: vi.fn(async (setting: Setting) => setting),
		};
		const manager = { getRepository: vi.fn(() => repository) };
		const dataSource = {
			getRepository: vi.fn(() => repository),
			transaction: (run: (manager: never) => Promise<void>) => run(manager as never),
		} as unknown as DataSource;
		const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ accepted: true }), { status: 200 }));
		vi.stubGlobal("fetch", fetch);
		const service = new AiAdminService(dataSource);
		const body = JSON.stringify({ enabled: true, profile: "mini", allow_downloads: false, cache_refresh_interval_minutes: 5 });

		await expect(
			service.applyConfiguration({
				enabled: true,
				profile: "mini",
				allowDownloads: false,
				cacheRefreshIntervalMinutes: 5,
			}),
		).resolves.toMatchObject({ applied: true });

		const [url, options] = fetch.mock.calls[0] as [URL, RequestInit];
		const timestamp = new Headers(options.headers).get("x-flixer-ai-timestamp");
		expect(url).toEqual(new URL("/admin/config", "http://ai:8094/"));
		expect(options.body).toBe(body);
		expect(new Headers(options.headers).get("x-flixer-ai-signature")).toBe(aiSignature(secret, timestamp ?? "", "POST", "/admin/config", Buffer.from(body)));
	});

	it("forces a fresh recommendation request for an administrator-selected user", async () => {
		const secret = "test-shared-secret-with-at-least-32-bytes";
		process.env.APP_SECRET = secret;
		process.env.FLIXER_AI_URL = "http://ai:8094";
		setAppConfig(new AppConfig(null));
		const settings = [
			{ key: "ai_enabled", value: true },
			{ key: "ai_profile", value: "auto" },
			{ key: "ai_allow_downloads", value: true },
			{ key: "ai_cache_refresh_interval_minutes", value: 10 },
		] as Setting[];
		const repository = { findBy: vi.fn(async () => settings) };
		const dataSource = { getRepository: vi.fn(() => repository) } as unknown as DataSource;
		const result = { items: [{ id: "media-id", score: 0.9 }] };
		const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(result), { status: 200 }));
		vi.stubGlobal("fetch", fetch);
		const service = new AiAdminService(dataSource);
		const userId = "00000000-0000-4000-8000-000000000001";

		await expect(service.forceRefreshRecommendations(userId)).resolves.toEqual(result);
		const [url, options] = fetch.mock.calls[0] as [URL, RequestInit];
		const timestamp = new Headers(options.headers).get("x-flixer-ai-timestamp");
		const path = `/admin/users/${userId}/recommendations/refresh`;
		expect(url).toEqual(new URL(path, "http://ai:8094/"));
		expect(new Headers(options.headers).get("x-flixer-ai-signature")).toBe(aiSignature(secret, timestamp ?? "", "POST", path, Buffer.from("{}")));
		expect(options.signal).toBeDefined();
	});
});
