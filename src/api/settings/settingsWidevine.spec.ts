import { describe, expect, it, vi } from "vitest";
import type { DataSource } from "typeorm";
import { Setting } from "../../entities/setting.entity.js";
import { SettingsService } from "./settingsService.js";

function createService(initial: Record<string, unknown> = {}) {
	const settings = new Map(
		Object.entries(initial).map(([key, value]) => [
			key,
			{ key, value, isPublic: true, updatedAt: new Date() } as Setting,
		]),
	);
	const repository = {
		findOneBy: vi.fn(async ({ key }: { key: string }) => settings.get(key) ?? null),
		save: vi.fn(async (setting: Setting) => setting),
	};
	const dataSource = { getRepository: vi.fn(() => repository) } as unknown as DataSource;
	const authService = { requireAdmin: vi.fn().mockResolvedValue(undefined) };
	const service = new SettingsService(
		dataSource,
		authService as never,
		{} as never,
		{} as never,
		{ mask: (_key: string, value: unknown) => value } as never,
		{} as never,
	);
	return { service, repository, settings };
}

describe("Widevine settings", () => {
	it("allows enabling DRM only after a valid license URL is saved", async () => {
		const { service, settings } = createService({
			widevine_drm_enabled: false,
			widevine_license_server_url: "",
		});

		await expect(service.update("widevine_drm_enabled", { value: true })).rejects.toThrow(/configure.*URL/i);
		await expect(service.update("widevine_license_server_url", { value: "https://license.example/widevine" }))
			.resolves.toMatchObject({ value: "https://license.example/widevine", isPublic: true });
		await expect(service.update("widevine_drm_enabled", { value: true }))
			.resolves.toMatchObject({ value: true, isPublic: true });
		expect(settings.get("widevine_drm_enabled")?.value).toBe(true);
	});

	it.each([
		"http://license.example/widevine",
		"https://user:password@license.example/widevine",
		"https://license.example/widevine?token=secret",
		"https://license.example/widevine#fragment",
	])("rejects unsafe license server URL %s", async (value) => {
		const { service, repository } = createService({ widevine_license_server_url: "" });
		await expect(service.update("widevine_license_server_url", { value })).rejects.toThrow(/HTTPS/i);
		expect(repository.save).not.toHaveBeenCalled();
	});

	it("requires the enable setting to be boolean", async () => {
		const { service, repository } = createService();
		await expect(service.update("widevine_drm_enabled", { value: "true" })).rejects.toThrow(/must be a boolean/i);
		expect(repository.findOneBy).not.toHaveBeenCalled();
	});
});

describe("player crop settings", () => {
	it.each(["player_crop_trailers", "player_crop_movies", "player_crop_tv"])("validates and saves %s", async (key) => {
		const { service, repository } = createService({ [key]: true });
		await expect(service.update(key, { value: "false" })).rejects.toThrow(/must be a boolean/i);
		expect(repository.save).not.toHaveBeenCalled();
		await expect(service.update(key, { value: false })).resolves.toMatchObject({ value: false, isPublic: true });
	});
});
