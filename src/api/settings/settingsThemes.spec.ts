import { describe, expect, it, vi } from "vitest";
import type { DataSource } from "typeorm";
import { Setting } from "../../entities/setting.entity.js";
import { SettingsService } from "./settingsService.js";

describe("themes_enabled setting", () => {
	it("reloads indexer settings when themes_enabled is updated", async () => {
		const setting = { key: "themes_enabled", value: false, isPublic: true, updatedAt: new Date() } as Setting;
		const repository = {
			findOneBy: vi.fn(async ({ key }: { key: string }) => (key === setting.key ? setting : null)),
			save: vi.fn(async (saved: Setting) => saved),
		};
		const dataSource = { getRepository: vi.fn(() => repository) } as unknown as DataSource;
		const auth = { requireAdmin: vi.fn().mockResolvedValue(undefined) };
		const indexerClient = { reloadSettings: vi.fn().mockResolvedValue(undefined) };
		const service = new SettingsService(dataSource, auth as never, {} as never, {} as never, { mask: (_key: string, value: unknown) => value } as never, indexerClient as never);

		await expect(service.update(setting.key, { value: true })).resolves.toMatchObject({ key: setting.key, value: true });
		expect(indexerClient.reloadSettings).toHaveBeenCalledTimes(1);
		await expect(service.update(setting.key, { value: "true" })).rejects.toThrow(/must be a boolean/i);
	});
});
