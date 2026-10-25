import { appConfig, type AppConfig } from "../config/store/appConfig.js";
import type { SetupState } from "../config/store/configStore.js";
import { needsRecovery } from "../setup/recovery.js";

export type DatabaseStatus = "ok" | "unconfigured" | "unavailable";

/** What the process is doing right now: "bootstrap" serves only setup endpoints, "ready" is the full application. */
export interface RuntimeState {
	mode: "bootstrap" | "ready";
	database: DatabaseStatus;
}

const runtime: RuntimeState = { mode: "bootstrap", database: "unconfigured" };

export function runtimeState(): RuntimeState {
	return runtime;
}

export function updateRuntime(next: Partial<RuntimeState>): void {
	Object.assign(runtime, next);
}

/**
 * Public and deliberately small: no addresses, secrets or settings. A client that cannot get this response must treat the
 * server as unavailable, never as "setup required".
 */
export interface SetupStatus {
	state: SetupState;
	mode: RuntimeState["mode"];
	database: DatabaseStatus;
	/** True once the persistent config store opens; false means flixer runs from environment variables alone. */
	persistent: boolean;
}

export function setupStatus(config: AppConfig = appConfig()): SetupStatus {
	const store = config.persistent;
	const state: SetupState = needsRecovery(config) ? "recovery_required" : (store?.setupState() ?? (config.get("databaseUrl") ? "completed" : "not_started"));
	return { state, mode: runtime.mode, database: runtime.database, persistent: store !== null };
}

/**
 * Installations that were configured through environment variables before the wizard existed are already set up.
 * The values stay in the environment (it overrides the store), so nothing is copied and no secret is regenerated.
 */
export function adoptEnvironmentInstall(config: AppConfig = appConfig()): void {
	const store = config.persistent;
	if (!store || store.setupState() === "completed") {
		return;
	}
	const configured = (["databaseUrl", "jwtSecret", "appSecret"] as const).every((name) => config.source(name) === "env");
	if (configured) {
		store.setSetupState("completed");
	}
}

/**
 * An installation that already has users is not a fresh one, whatever the config store says. A wizard that was pointed at
 * such a database on purpose is the exception: it keeps going until its remaining steps are done.
 */
export function adoptExistingUsers(hasUsers: boolean, config: AppConfig = appConfig()): void {
	const store = config.persistent;
	if (hasUsers && store && store.setupState() !== "completed" && !store.wizardProgress().adoptedAccounts) {
		store.setSetupState("completed");
	}
}
