import { describe, expect, it, vi } from "vitest";
import type { DataSource } from "typeorm";
import { Setting } from "../entities/setting.entity.js";
import { ADMIN_SCHEDULED_TASKS_SETTING } from "../jobs/adminScheduledTasks.js";
import { synchronizeSettings } from "./settingsSync.js";

describe("synchronizeSettings", () => {
	it("preserves saved scheduled task preferences while removing obsolete settings", async () => {
		const scheduledTasks = {
			"scan-libraries": { enabled: false, cron: "0 */12 * * *" },
		};
		const existingSettings = [
			{
				id: 1,
				key: ADMIN_SCHEDULED_TASKS_SETTING,
				value: scheduledTasks,
				isPublic: false,
			} as Setting,
			{ id: 2, key: "requests_webhook_token", value: "a".repeat(64), isPublic: false } as Setting,
			{ id: 3, key: "obsolete_setting", value: null, isPublic: false } as Setting,
		];
		const repository = {
			find: vi.fn(async () => existingSettings),
			create: vi.fn((setting: Partial<Setting>) => setting as Setting),
			remove: vi.fn(async (settings: Setting[]) => settings),
			save: vi.fn(async (settings: Setting[]) => settings),
		};
		const manager = {
			getRepository: vi.fn(() => repository),
			query: vi.fn(async () => undefined),
		};
		const dataSource = {
			transaction: (run: (manager: never) => Promise<void>) => run(manager as never),
		} as unknown as DataSource;

		await synchronizeSettings(dataSource);

		expect(repository.remove).toHaveBeenCalledWith([existingSettings[2]]);
		expect(existingSettings[0].value).toEqual(scheduledTasks);
	});

	it("creates a valid webhook token when the setting is missing", async () => {
		const settingsToSave: Setting[] = [];
		const repository = {
			find: vi.fn(async () => []),
			create: vi.fn((setting: Partial<Setting>) => setting as Setting),
			remove: vi.fn(async (settings: Setting[]) => settings),
			save: vi.fn(async (settings: Setting[]) => {
				settingsToSave.push(...settings);
				return settings;
			}),
		};
		const manager = {
			getRepository: vi.fn(() => repository),
			query: vi.fn(async () => undefined),
		};
		const dataSource = {
			transaction: (run: (manager: never) => Promise<void>) => run(manager as never),
		} as unknown as DataSource;

		await synchronizeSettings(dataSource);

		const webhookToken = settingsToSave.find(({ key }) => key === "requests_webhook_token");
		expect(webhookToken).toMatchObject({ isPublic: false });
		expect(webhookToken?.value).toMatch(/^[a-f0-9]{64}$/);
	});

	it("replaces an invalid webhook token with a generated secret", async () => {
		const invalidToken = { id: 1, key: "requests_webhook_token", value: null, isPublic: false } as Setting;
		const repository = {
			find: vi.fn(async () => [invalidToken]),
			create: vi.fn((setting: Partial<Setting>) => setting as Setting),
			remove: vi.fn(async (settings: Setting[]) => settings),
			save: vi.fn(async (settings: Setting[]) => settings),
		};
		const manager = {
			getRepository: vi.fn(() => repository),
			query: vi.fn(async () => undefined),
		};
		const dataSource = {
			transaction: (run: (manager: never) => Promise<void>) => run(manager as never),
		} as unknown as DataSource;

		await synchronizeSettings(dataSource);

		expect(repository.save.mock.calls.flatMap(([settings]) => settings)).toContain(invalidToken);
		expect(invalidToken.value).toMatch(/^[a-f0-9]{64}$/);
	});
});
