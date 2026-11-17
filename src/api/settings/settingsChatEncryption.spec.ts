import { describe, expect, it, vi } from "vitest";
import type { DataSource } from "typeorm";
import { Setting } from "../../entities/setting.entity.js";
import { SettingsService } from "./settingsService.js";

type MockRepository = {
	findOneBy: (criteria: { key: string }) => Promise<Setting | null>;
	save: (setting: Setting) => Promise<Setting>;
};

const makeSetting = (key: string, value: boolean): Setting =>
	({
		key,
		value,
		isPublic: false,
		updatedAt: new Date(),
	}) as Setting;

function createService(dataSource: DataSource) {
	const authService = { requireAdmin: vi.fn().mockResolvedValue(undefined) };
	return new SettingsService(dataSource, authService as never, {} as never, {} as never, { mask: (_key: string, value: unknown) => value } as never, {} as never);
}

describe("chat encryption setting", () => {
	it("allows administrators to switch modes without deleting existing messages", async () => {
		const setting = makeSetting("chat_e2ee_enabled", false);
		const downgradeSetting = makeSetting("chat_user_downgrade_enabled", false);
		const settings = new Map([
			[setting.key, setting],
			[downgradeSetting.key, downgradeSetting],
		]);
		const repository: MockRepository = {
			findOneBy: vi.fn(async ({ key }) => settings.get(key) ?? null),
			save: vi.fn(async (saved) => saved),
		};
		const dataSource = { getRepository: vi.fn(() => repository) } as unknown as DataSource;
		const service = createService(dataSource);

		await expect(service.update("chat_e2ee_enabled", { value: true })).resolves.toMatchObject({
			key: "chat_e2ee_enabled",
			value: true,
		});
		expect(setting.value).toBe(true);

		await expect(service.update("chat_e2ee_enabled", { value: false })).resolves.toMatchObject({
			key: "chat_e2ee_enabled",
			value: false,
		});
		expect(setting.value).toBe(false);
		await expect(service.update("chat_user_downgrade_enabled", { value: true })).resolves.toMatchObject({
			key: "chat_user_downgrade_enabled",
			value: true,
		});
		expect(downgradeSetting.value).toBe(true);
		expect(repository.save).toHaveBeenCalledTimes(3);
	});

	it("requires the user downgrade permission to be a boolean", async () => {
		const dataSource = { getRepository: vi.fn() } as unknown as DataSource;
		const service = createService(dataSource);

		await expect(service.update("chat_user_downgrade_enabled", { value: "true" })).rejects.toThrow(/must be a boolean/i);
		expect(dataSource.getRepository).not.toHaveBeenCalled();
	});
});
