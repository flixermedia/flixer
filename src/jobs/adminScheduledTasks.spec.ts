import { describe, expect, it } from "vitest";
import {
	ADMIN_SCHEDULED_TASKS,
	defaultAdminScheduledTaskConfigs,
	readAdminScheduledTaskConfigs,
} from "./adminScheduledTasks.js";

describe("admin scheduled task configuration", () => {
	it("keeps explicitly disabled schedules disabled when loading persisted settings", () => {
		const defaults = defaultAdminScheduledTaskConfigs();
		const stored = {
			"scan-libraries": { enabled: false, cron: defaults["scan-libraries"].cron },
		};

		expect(readAdminScheduledTaskConfigs(stored)["scan-libraries"]).toEqual({
			enabled: false,
			cron: defaults["scan-libraries"].cron,
		});
		expect(readAdminScheduledTaskConfigs(stored)["refresh-metadata"]).toEqual(defaults["refresh-metadata"]);
	});

	it("rejects malformed persisted schedule values", () => {
		expect(() =>
			readAdminScheduledTaskConfigs({
				"scan-libraries": { enabled: "false", cron: "0 */12 * * *" },
			}),
		).toThrow("Stored schedule for scan-libraries is invalid.");
	});

	it("exposes the daily EPG refresh as an enabled admin-scheduled task", () => {
		const task = ADMIN_SCHEDULED_TASKS.find(({ id }) => id === "refresh-epg");

		expect(task).toMatchObject({
			name: "Refresh EPG data",
			category: "Guide",
			defaultCron: "0 3 * * *",
		});
		expect(defaultAdminScheduledTaskConfigs()["refresh-epg"]).toEqual({
			enabled: true,
			cron: "0 3 * * *",
		});
	});
});
