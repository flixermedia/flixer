import { describe, expect, it, vi } from "vitest";
import type { DataSource } from "typeorm";
import { Setting } from "../../entities/setting.entity.js";
import { SettingsService } from "./settingsService.js";

function createService() {

	const setting = { key: "quick_connect_enabled", value: false, isPublic: true, updatedAt: new Date() } as Setting;
	const repository = {
		findOneBy: vi.fn().mockResolvedValue(setting),
		save: vi.fn(async (updated: Setting) => updated),
	};
	const dataSource = { getRepository: vi.fn(() => repository) } as unknown as DataSource;
	const service = new SettingsService(dataSource, { requireAdmin: vi.fn().mockResolvedValue(undefined) } as never, {} as never, {} as never, { mask: (_key: string, value: unknown) => value } as never, {} as never);

	return { service, repository, setting };

}

describe("Quick Connect setting", () => {
	it("requires a boolean value and allows an administrator to enable it", async () => {
		const { service, repository, setting } = createService();

		await expect(service.update("quick_connect_enabled", { value: "true" })).rejects.toThrow(/must be a boolean/i);
		expect(repository.findOneBy).not.toHaveBeenCalled();

		await expect(service.update("quick_connect_enabled", { value: true })).resolves.toMatchObject({
			key: "quick_connect_enabled",
			value: true,
			isPublic: true,
		});
		expect(setting.value).toBe(true);
	});
});
