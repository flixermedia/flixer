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
			{ id: 2, key: "obsolete_setting", value: null, isPublic: false } as Setting,
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

		expect(repository.remove).toHaveBeenCalledWith([existingSettings[1]]);
		expect(existingSettings[0].value).toEqual(scheduledTasks);
	});
});
