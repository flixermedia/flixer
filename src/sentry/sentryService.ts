import * as Sentry from "@sentry/node";
import { Inject, Injectable, logger } from "@tsed/di";
import { DataSource } from "typeorm";
import { DefaultDataSource } from "../datasources/defaultDataSource.datasource.js";
import { Setting } from "../entities/setting.entity.js";
import { version } from "../config/config.js";

export const SENTRY_APPS = ["flixer", "streamer", "indexer", "web"] as const;
export type SentryApp = (typeof SENTRY_APPS)[number];

export interface SentryAppConfig {
	enabled: boolean;
	dsn: string | null;
}

export const SENTRY_SETTING_KEYS = [
	"sentry_enabled",
	...SENTRY_APPS.map((app) => `sentry_${app}_enabled`),
	...SENTRY_APPS.map((app) => `sentry_${app}_dsn`),
];

export function isSentryApp(value: string): value is SentryApp {
	return (SENTRY_APPS as readonly string[]).includes(value);
}

/**
 * Resolves the Sentry configuration for every Flixer app from the settings table and
 * runs Sentry for the backend itself. Sentry is active only when the global switch,
 * the per-app switch and a DSN are all present.
 */
@Injectable()
export class SentryService {

	private active = false;

	constructor(@Inject(DefaultDataSource) private readonly dataSource: DataSource) {}

	async $onReady(): Promise<void> {
		await this.apply();
	}

	async $onDestroy(): Promise<void> {
		if (this.active) {
			await Sentry.close(2_000);
			this.active = false;
		}
	}

	async getConfig(app: SentryApp): Promise<SentryAppConfig> {
		const settings = await this.dataSource.getRepository(Setting).find();
		const values = new Map(settings.map((setting) => [setting.key, setting.value]));
		const dsn = values.get(`sentry_${app}_dsn`);
		const enabled =
			values.get("sentry_enabled") === true &&
			values.get(`sentry_${app}_enabled`) === true &&
			typeof dsn === "string" &&
			dsn.trim() !== "";

		return { enabled, dsn: enabled ? (dsn as string).trim() : null };
	}

	/** Starts, restarts or stops Sentry for flixer so admin changes take effect without a restart. */
	async apply(): Promise<void> {
		try {
			const config = await this.getConfig("flixer");
			if (this.active) {
				await Sentry.close(2_000);
				this.active = false;
			}
			if (config.enabled && config.dsn) {
				Sentry.init({
					dsn: config.dsn,
					release: `flixer@${version}`,
					environment: process.env.NODE_ENV ?? "development",
					// Errors the app catches and only logs would otherwise never reach Sentry.
    				// integrations: [Sentry.captureConsoleIntegration({ levels: ['error'] })],
				});
				this.active = true;
			}
			logger().info(`Sentry monitoring is ${this.active ? "enabled" : "disabled"}.`);
		} catch (error) {
			logger().error("Failed to apply the Sentry configuration.", error);
		}
	}

	captureException(error: unknown): void {
		if (this.active) {
			Sentry.captureException(error);
		}
	}
}
