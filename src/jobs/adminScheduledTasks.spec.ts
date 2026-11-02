import { describe, expect, it } from "vitest";
import { defaultAdminScheduledTaskConfigs, readAdminScheduledTaskConfigs } from "./adminScheduledTasks.js";

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
});
