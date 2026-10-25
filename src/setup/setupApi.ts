import { appConfig } from "../config/store/appConfig.js";
import { CONFIG_KEYS, suggestedDatabaseUrl, suggestedRedisUrl, type ConfigName } from "../config/store/configSchema.js";
import { ConfigValidationError } from "../config/store/configStore.js";
import { runtimeState, setupStatus } from "../bootstrap/setupStatus.js";
import { $log } from "@tsed/logger";
import { checkRecoveryCode, logRecoveryKey, needsRecovery } from "./recovery.js";
import { defaultProbes, findStep, SETUP_STEPS, SetupError, type Probes, type StepContext } from "./setupSteps.js";

export interface SetupResponse {
	status: number;
	body: unknown;
}

export interface SetupRequestContext {
	/** Whether the caller is a signed-in administrator. Only asked when the request is not open to everyone. */
	isAdmin(): Promise<boolean>;
	/** Whether an administrator account exists; always false while PostgreSQL is not up. */
	adminExists(): Promise<boolean>;
	/** The recovery key the caller sent, if any: it lets whoever can read the server log run setup without signing in. */
	recoveryCode?: string;
	probes?: Probes;
}

const FLOWS = new Set(["quick", "advanced"]);

function ok(body: unknown, status = 200): SetupResponse {
	return { status, body };
}

/**
 * Setup is open to anyone only while nothing is protected yet: the wizard has not been completed and no administrator
 * exists. After that, changing configuration takes an administrator, in either flow.
 */
async function authorize(context: SetupRequestContext, route: string): Promise<void> {
	if (needsRecovery()) {
		// Only the database can be reconnected this way; everything else waits for a signed-in administrator.
		if (route !== "/progress" && !/^\/steps\/database(\/test)?$/.test(route)) {
			throw new SetupError(403, "Only the database can be reconnected while recovering.");
		}
		const check = checkRecoveryCode(context.recoveryCode);
		if (check === "throttled") {
			throw new SetupError(429, "Too many wrong recovery codes. Try again in a few minutes.");
		}
		if (check === "invalid") {
			throw new SetupError(403, "The recovery code is missing or wrong. It is printed in the Flixer server log.");
		}
		return;
	}
	const store = appConfig().persistent;
	const state = store?.setupState() ?? "not_started";
	if (state === "not_started" || state === "in_progress") {
		if (!(await context.adminExists()) || store?.wizardProgress().adoptedAccounts) {
			return;
		}
	}
	if (context.recoveryCode !== undefined && !(await context.isAdmin())) {
		// Reopening setup from scratch stays with a signed-in administrator; the key only continues or repairs it.
		if (route === "/reset") {
			throw new SetupError(403, "Administrator access is required.");
		}
		const check = checkRecoveryCode(context.recoveryCode);
		if (check === "throttled") {
			throw new SetupError(429, "Too many wrong recovery keys. Try again in a few minutes.");
		}
		if (check === "invalid") {
			throw new SetupError(403, "The recovery key is wrong. It is printed in the Flixer server log after you ask for it.");
		}
		return;
	}
	if (runtimeState().mode !== "ready") {
		throw new SetupError(403, "Setup is locked. Sign in as an administrator once Flixer has finished starting.");
	}
	if (!(await context.isAdmin())) {
		throw new SetupError(403, "Administrator access is required.");
	}
}

function requireStore(): NonNullable<ReturnType<typeof appConfig>["persistent"]> {
	const store = appConfig().persistent;
	if (!store) {
		throw new SetupError(503, "The configuration directory under DATA_PATH/config is not writable, so setup cannot save anything.");
	}
	return store;
}

function stepContext(context: SetupRequestContext): StepContext {
	return { config: appConfig(), store: requireStore(), probes: context.probes ?? defaultProbes, adminExists: context.adminExists };
}

/** What the wizard may pre-fill: values for plain settings, and only whether a secret is set, never the secret. */
function describeConfig() {
	const config = appConfig();
	return Object.fromEntries(
		(Object.keys(CONFIG_KEYS) as ConfigName[]).map((name) => {
			const definition = CONFIG_KEYS[name];
			const defaultValue = name === "databaseUrl" ? suggestedDatabaseUrl() : name === "redisUrl" ? suggestedRedisUrl() : (definition as { defaultValue?: string }).defaultValue;
			return [name, { source: config.source(name), locked: config.source(name) === "env", set: config.get(name) !== undefined && config.get(name) !== "", value: definition.secret ? undefined : config.get(name), default: defaultValue }];
		}),
	);
}

async function progress(context: SetupRequestContext) {
	const store = requireStore();
	const wizard = store.wizardProgress();
	return {
		...setupStatus(),
		flow: wizard.flow,
		completedSteps: wizard.completedSteps,
		steps: SETUP_STEPS.map((step) => ({ id: step.id, title: step.title, canTest: step.test !== undefined })),
		adminExists: await context.adminExists(),
		config: describeConfig(),
	};
}

/** What is still missing before setup can be marked complete. */
export async function completionBlockers(context: Pick<SetupRequestContext, "adminExists">): Promise<string[]> {
	const config = appConfig();
	const blockers: string[] = [];
	if (!config.get("databaseUrl") || runtimeState().database !== "ok" || runtimeState().mode !== "ready") {
		blockers.push("The database is not connected.");
	} else if (!(await context.adminExists())) {
		blockers.push("No administrator account exists.");
	}
	if (!config.get("redisUrl")) {
		blockers.push("Redis is not configured.");
	}
	if (!config.get("publicUrl")) {
		blockers.push("The public address is not configured.");
	}
	return blockers;
}

/**
 * Handles every /api/setup route other than the public status, for both the bootstrap server and the full application.
 * Returns null for paths that are not setup routes.
 */
export async function handleSetupRequest(method: string, path: string, body: unknown, context: SetupRequestContext): Promise<SetupResponse | null> {
	const route = /^\/api\/setup(\/.*)?$/.exec(path)?.[1] ?? "";
	const stepRoute = /^\/steps\/([a-z]+)(\/test)?$/.exec(route);
	const handled = (method === "GET" && route === "/progress") || (method === "POST" && (stepRoute !== null || route === "/flow" || route === "/complete" || route === "/reset"));
	if (method === "POST" && route === "/recovery/request") {
		logRecoveryKey((message) => $log.warn(message));
		return ok({ requested: true });
	}
	if (!handled) {
		return null;
	}
	try {
		await authorize(context, route);
		if (route === "/progress") {
			return ok(await progress(context));
		}
		const store = requireStore();
		if (route === "/flow") {
			const flow = (body as { flow?: unknown } | null)?.flow;
			if (typeof flow !== "string" || !FLOWS.has(flow)) {
				throw new SetupError(400, "flow must be quick or advanced.");
			}
			store.setWizardProgress({ ...store.wizardProgress(), flow: flow as "quick" | "advanced" });
			markStarted();
			return ok({ flow });
		}
		if (route === "/complete") {
			if (store.wizardProgress().flow === "quick") {
				const config = appConfig();
				const defaults: Partial<Record<ConfigName, string>> = {};
				for (const name of ["redisUrl", "indexerUrl", "streamerInternalUrl"] as const) {
					if (config.source(name) === "unset" || config.source(name) === "default") {
						const value = name === "redisUrl" ? suggestedRedisUrl() : config.get(name);
						if (value) {
							defaults[name] = value;
						}
					}
				}
				if (Object.keys(defaults).length > 0) {
					store.setMany(defaults);
				}
			}
			if (!appConfig().get("redisUrl")) {
				store.setMany({ redisUrl: suggestedRedisUrl() });
			}
			const blockers = await completionBlockers(context);
			if (blockers.length > 0) {
				throw new SetupError(409, blockers.join(" "));
			}
			store.setSetupState("completed");
			return ok({ state: "completed" });
		}
		if (route === "/reset") {
			if ((body as { confirm?: unknown } | null)?.confirm !== "RESET") {
				throw new SetupError(400, 'Send { "confirm": "RESET" } to reopen setup.');
			}
			store.reset();
			return ok({ state: "not_started" });
		}

		const step = findStep(stepRoute![1]);
		if (!step) {
			throw new SetupError(404, "Unknown setup step.");
		}
		const parsed = step.parse(body);
		if ("errors" in parsed) {
			throw new SetupError(400, "Some values are not valid.", parsed.errors);
		}
		const stepEnv = stepContext(context);
		if (stepRoute![2]) {
			if (!step.test) {
				throw new SetupError(404, "This step has nothing to test.");
			}
			return ok(await step.test(parsed.values, stepEnv));
		}
		const result = await step.apply(parsed.values, stepEnv);
		markStarted();
		const wizard = store.wizardProgress();
		store.setWizardProgress({ ...wizard, completedSteps: [...new Set([...wizard.completedSteps, step.id])] });
		return ok(result);
	} catch (error: unknown) {
		if (error instanceof SetupError) {
			return { status: error.status, body: { error: error.message, fields: error.fields } };
		}
		if (error instanceof ConfigValidationError) {
			return { status: 400, body: { error: error.message } };
		}
		throw error;
	}
}

function markStarted(): void {
	const store = appConfig().persistent;
	if (store?.setupState() === "not_started") {
		store.setSetupState("in_progress");
	}
}
