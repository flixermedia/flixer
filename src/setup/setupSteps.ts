import { randomBytes } from "node:crypto";
import { CONFIG_KEYS, validateHttpUrl, validatePostgresUrl, validateRedisUrl, validateSecret, type ConfigName } from "../config/store/configSchema.js";
import type { AppConfig } from "../config/store/appConfig.js";
import type { ConfigStore } from "../config/store/configStore.js";
import { probeDatabase, type DatabaseProbe } from "../bootstrap/databaseProbe.js";
import { retryDatabaseNow } from "../bootstrap/waitForDatabase.js";
import { publishStreamTokenSecret } from "../config/store/sharedSecret.js";
import { probeRedis, type RedisProbe } from "./redisProbe.js";
import { resolveUrls, type FieldErrors } from "./urlRules.js";

export class SetupError extends Error {
	constructor(readonly status: number, message: string, readonly fields?: FieldErrors) {
		super(message);
	}
}

export interface Probes {
	database(url: string): Promise<DatabaseProbe>;
	redis(url: string): Promise<RedisProbe>;
	http(url: string): Promise<{ ok: boolean; message?: string }>;
}

export interface StepContext {
	config: AppConfig;
	store: ConfigStore;
	probes: Probes;
	adminExists(): Promise<boolean>;
}

export interface StepResult {
	ok: boolean;
	message?: string;
	/** Other services that must be restarted for the change to take effect. */
	restart?: string[];
}

type Parsed = { values: Partial<Record<ConfigName, string>> } | { errors: FieldErrors };

/**
 * One wizard step on the server. Steps are independent: the front end decides the order and which flow shows which, and
 * each step validates its own input, can test it live without saving, and saves only what it owns.
 */
export interface SetupStep {
	id: string;
	title: string;
	parse(input: unknown): Parsed;
	test?(values: Partial<Record<ConfigName, string>>, context: StepContext): Promise<StepResult>;
	apply(values: Partial<Record<ConfigName, string>>, context: StepContext): Promise<StepResult>;
}

function record(input: unknown): Record<string, unknown> {
	return typeof input === "object" && input !== null && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
}

function text(input: Record<string, unknown>, field: string): string {
	const value = input[field];
	return typeof value === "string" ? value.trim() : "";
}

/** A value from an environment variable wins over the store, so saving a different one here would silently do nothing. */
export function environmentConflicts(values: Partial<Record<ConfigName, string>>, config: AppConfig): FieldErrors {
	const errors: FieldErrors = {};
	for (const [name, value] of Object.entries(values) as [ConfigName, string][]) {
		if (config.source(name) === "env" && config.get(name) !== value) {
			errors[name] = `Set by the ${CONFIG_KEYS[name].env} environment variable. Remove it to change this here.`;
		}
	}
	return errors;
}

function requiredUrl(input: Record<string, unknown>, field: string, validate: (value: string) => string | null, errors: FieldErrors): string {
	const value = text(input, field);
	const problem = value ? validate(value) : "Required.";
	if (problem) {
		errors[field] = problem;
	}
	return value;
}

function save(values: Partial<Record<ConfigName, string>>, context: StepContext): void {
	const conflicts = environmentConflicts(values, context.config);
	if (Object.keys(conflicts).length > 0) {
		throw new SetupError(409, "Some values are set by environment variables.", conflicts);
	}
	context.store.setMany(values);
}

const databaseStep: SetupStep = {
	id: "database",
	title: "Database",
	parse(input) {
		const errors: FieldErrors = {};
		const databaseUrl = requiredUrl(record(input), "databaseUrl", validatePostgresUrl, errors);
		return Object.keys(errors).length > 0 ? { errors } : { values: { databaseUrl } };
	},
	async test(values, { probes }) {
		const result = await probes.database(values.databaseUrl as string);
		return result.ok ? { ok: true } : { ok: false, message: result.message };
	},
	async apply(values, context) {
		// Recorded before the server reconnects, so existing accounts do not mark a half-finished setup as complete.
		const probe = await context.probes.database(values.databaseUrl as string);
		if (probe.ok && probe.hasUsers) {
			context.store.setWizardProgress({ ...context.store.wizardProgress(), adoptedAccounts: true });
		}
		save(values, context);
		retryDatabaseNow();
		return { ok: true, restart: [] };
	},
};

const redisStep: SetupStep = {
	id: "redis",
	title: "Redis",
	parse(input) {
		const errors: FieldErrors = {};
		const redisUrl = requiredUrl(record(input), "redisUrl", validateRedisUrl, errors);
		return Object.keys(errors).length > 0 ? { errors } : { values: { redisUrl } };
	},
	async test(values, { probes }) {
		const result = await probes.redis(values.redisUrl as string);
		return result.ok ? { ok: true } : { ok: false, message: result.message };
	},
	async apply(values, context) {
		save(values, context);
		return { ok: true, restart: ["indexer"] };
	},
};

const urlsStep: SetupStep = {
	id: "urls",
	title: "Addresses",
	parse(input) {
		const source = record(input);
		const resolved = resolveUrls({ publicUrl: text(source, "publicUrl"), appUrl: text(source, "appUrl"), passkeyRpId: text(source, "passkeyRpId"), passkeyOrigins: text(source, "passkeyOrigins") });
		return "errors" in resolved ? resolved : { values: resolved.values };
	},
	async apply(values, context) {
		save(values, context);
		return { ok: true };
	},
};

const servicesStep: SetupStep = {
	id: "services",
	title: "Services",
	parse(input) {
		const source = record(input);
		const errors: FieldErrors = {};
		const indexerUrl = requiredUrl(source, "indexerUrl", validateHttpUrl, errors);
		const streamerInternalUrl = requiredUrl(source, "streamerInternalUrl", validateHttpUrl, errors);
		const streamerPublicUrl = text(source, "streamerPublicUrl");
		if (streamerPublicUrl && validateHttpUrl(streamerPublicUrl)) {
			errors.streamerPublicUrl = validateHttpUrl(streamerPublicUrl) as string;
		}
		return Object.keys(errors).length > 0 ? { errors } : { values: { indexerUrl, streamerInternalUrl, streamerPublicUrl } };
	},
	async test(values, { probes }) {
		const results = await Promise.all([values.indexerUrl, values.streamerInternalUrl].map((url) => probes.http(url as string)));
		const failed = results.find((result) => !result.ok);
		return failed ? { ok: false, message: failed.message } : { ok: true };
	},
	async apply(values, context) {
		save(values, context);
		return { ok: true };
	},
};

const SECRET_NAMES = ["jwtSecret", "streamTokenSecret"] as const;

const secretsStep: SetupStep = {
	id: "secrets",
	title: "Secrets",
	parse(input) {
		const source = record(input);
		const errors: FieldErrors = {};
		const values: Partial<Record<ConfigName, string>> = {};
		for (const name of SECRET_NAMES) {
			const value = text(source, name);
			if (value) {
				const problem = validateSecret(value);
				if (problem) {
					errors[name] = problem;
				}
				values[name] = value;
			} else if (Array.isArray(source.generate) && source.generate.includes(name)) {
				values[name] = randomBytes(48).toString("base64url");
			}
		}
		if (Object.keys(errors).length === 0 && Object.keys(values).length === 0) {
			errors.generate = "Provide a secret or ask for one to be generated.";
		}
		return Object.keys(errors).length > 0 ? { errors } : { values };
	},
	async apply(values, context) {
		save(values, context);
		publishStreamTokenSecret(context.config);
		const restart = ["api"];
		if (values.streamTokenSecret) {
			restart.push("indexer", "streamer");
		}
		return { ok: true, message: values.jwtSecret ? "Everyone will have to sign in again." : undefined, restart };
	},
};

const adminStep: SetupStep = {
	id: "admin",
	title: "Administrator",
	parse: () => ({ values: {} }),
	async apply(_values, { adminExists }) {
		if (!(await adminExists())) {
			throw new SetupError(409, "Create the administrator account first.");
		}
		return { ok: true };
	},
};

/** Every step the server knows. The wizard front end picks which of them each flow shows, and in what order. */
export const SETUP_STEPS: readonly SetupStep[] = [databaseStep, redisStep, urlsStep, adminStep, servicesStep, secretsStep];

export function findStep(id: string): SetupStep | undefined {
	return SETUP_STEPS.find((step) => step.id === id);
}

export const defaultProbes: Probes = {
	database: probeDatabase,
	redis: probeRedis,
	async http(url) {
		try {
			// Any HTTP answer proves the service is reachable; only a refused or timed-out connection fails.
			await fetch(url, { signal: AbortSignal.timeout(4000), redirect: "manual" });
			return { ok: true };
		} catch (error: unknown) {
			const cause = error instanceof Error && error.cause instanceof Error ? error.cause.message : error instanceof Error ? error.message : String(error);
			return { ok: false, message: `${url} is not reachable: ${cause}` };
		}
	},
};
