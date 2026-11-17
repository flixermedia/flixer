import { describe, expect, it, vi } from "vitest";
import type { DataSource } from "typeorm";
import { isSentryApp, SentryService } from "./sentryService.js";

describe.each(["ai", "logger", "updater"] as const)("Sentry configuration for %s", (app) => {
	it("requires the global switch, app switch and DSN", async () => {
		const values: Record<string, unknown> = {
			sentry_enabled: true,
			[`sentry_${app}_enabled`]: true,
			[`sentry_${app}_dsn`]: " https://public@example.invalid/1 ",
		};
		const repository = { find: vi.fn(async () => Object.entries(values).map(([key, value]) => ({ key, value }))) };
		const dataSource = { getRepository: () => repository } as unknown as DataSource;
		const service = new SentryService(dataSource);
		expect(isSentryApp(app)).toBe(true);
		expect(await service.getConfig(app)).toEqual({ enabled: true, dsn: "https://public@example.invalid/1" });
		values.sentry_enabled = false;
		expect(await service.getConfig(app)).toEqual({ enabled: false, dsn: null });
		values.sentry_enabled = true;
		values[`sentry_${app}_enabled`] = false;
		expect(await service.getConfig(app)).toEqual({ enabled: false, dsn: null });
		values[`sentry_${app}_enabled`] = true;
		values[`sentry_${app}_dsn`] = null;
		expect(await service.getConfig(app)).toEqual({ enabled: false, dsn: null });
	});
});
