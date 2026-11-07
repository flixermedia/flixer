import { describe, expect, it, vi } from "vitest";
import type { DataSource } from "typeorm";
import { Setting } from "../../entities/setting.entity.js";
import { SettingsService } from "./settingsService.js";

describe("trailer cache setting", () => {
	it("allows an administrator to enable caching and rejects non-boolean values", async () => {
		const setting = { key: "trailers_cache_enabled", value: false, isPublic: false, updatedAt: new Date() } as Setting;
		const repository = {
			findOneBy: vi.fn(async ({ key }: { key: string }) => key === setting.key ? setting : null),
			save: vi.fn(async (saved: Setting) => saved),
		};
		const dataSource = { getRepository: vi.fn(() => repository) } as unknown as DataSource;
		const auth = { requireAdmin: vi.fn().mockResolvedValue(undefined) };
		const service = new SettingsService(dataSource, auth as never, {} as never, {} as never, { mask: (_key: string, value: unknown) => value } as never, {} as never);

		await expect(service.update(setting.key, { value: true })).resolves.toMatchObject({ key: setting.key, value: true });
		await expect(service.update(setting.key, { value: "true" })).rejects.toThrow(/must be a boolean/i);
	});
});
