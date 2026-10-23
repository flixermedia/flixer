import { $log } from "@tsed/logger";
import { resolve } from "node:path";
import { CONFIG_KEYS, type ConfigName } from "./configSchema.js";
import { ConfigStore, type ConfigSource } from "./configStore.js";

/**
 * Reads configuration with a fixed priority: the environment variable for that key, then the saved SQLite value, then the
 * built-in default. Each key is resolved on its own, so setting one environment variable never disables the others, and
 * a .env file is just another source of environment variables.
 */
export class AppConfig {

	constructor(private readonly store: ConfigStore | null) {}

	private fromEnv(name: ConfigName): string | undefined {
		const definition: { env: string; envAliases?: readonly string[] } = CONFIG_KEYS[name];
		for (const variable of [definition.env, ...(definition.envAliases ?? [])]) {
			const value = process.env[variable]?.trim();
			if (value) {
				return value;
			}
		}
		return undefined;
	}

	get(name: ConfigName): string | undefined {
		return this.fromEnv(name) ?? this.store?.get(name) ?? (CONFIG_KEYS[name] as { defaultValue?: string }).defaultValue;
	}

	/** Like get, for values the service cannot run without. */
	require(name: ConfigName): string {
		const value = this.get(name);
		if (!value) {
			throw new Error(`${CONFIG_KEYS[name].env} is not configured. Set it in the environment or finish setup.`);
		}
		return value;
	}

	source(name: ConfigName): ConfigSource {
		if (this.fromEnv(name) !== undefined) {
			return "env";
		}
		if (this.store?.has(name)) {
			return "store";
		}
		return (CONFIG_KEYS[name] as { defaultValue?: string }).defaultValue !== undefined ? "default" : "unset";
	}

	/** The persistent store, or null when its directory is not writable and flixer runs from the environment alone. */
	get persistent(): ConfigStore | null {
		return this.store;
	}

}

export function configDirectory(): string {
	return resolve(process.env.CONFIG_DIR?.trim() || "./data/config");
}

let instance: AppConfig | undefined;

/** The shared configuration. The store opens on first use; if it cannot be opened, environment variables and defaults still work. */
export function appConfig(): AppConfig {
	if (!instance) {
		let store: ConfigStore | null = null;
		try {
			store = new ConfigStore(configDirectory());
		} catch (error: unknown) {
			$log.warn({ event: "CONFIG_STORE_UNAVAILABLE", message: error instanceof Error ? error.message : String(error) });
		}
		instance = new AppConfig(store);
	}
	return instance;
}

/** Replaces the shared configuration; for tests. */
export function setAppConfig(config: AppConfig | undefined): void {
	instance = config;
}
