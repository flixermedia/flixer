export interface LoginSecurityConfig {
	timingEnabled: boolean;
	minimumMs: number;
	jitterMs: number;
	throttleEnabled: boolean;
	ipLimit: number;
	usernameLimit: number;
	windowSeconds: number;
}

export const DEFAULT_LOGIN_SECURITY: LoginSecurityConfig = {
	timingEnabled: true,
	minimumMs: 400,
	jitterMs: 40,
	throttleEnabled: true,
	ipLimit: 20,
	usernameLimit: 10,
	windowSeconds: 60,
};

let current = { ...DEFAULT_LOGIN_SECURITY };
let revision = 0;

export function validateLoginSecurity(value: unknown): LoginSecurityConfig {

	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("Login security settings must be an object.");
	const config = value as Record<string, unknown>;
	if (typeof config.timingEnabled !== "boolean" || typeof config.throttleEnabled !== "boolean") throw new Error("Login security flags must be booleans.");
	for (const [key, minimum, maximum] of [
		["minimumMs", 100, 5000],
		["jitterMs", 0, 1000],
		["ipLimit", 1, 1000],
		["usernameLimit", 1, 1000],
		["windowSeconds", 10, 3600],
	] as const) {
		const field = config[key];
		if (typeof field !== "number" || !Number.isInteger(field) || field < minimum || field > maximum) {
			throw new Error(`${key} must be a whole number between ${minimum} and ${maximum}.`);
		}
	}
	return {
		timingEnabled: config.timingEnabled,
		minimumMs: config.minimumMs as number,
		jitterMs: config.jitterMs as number,
		throttleEnabled: config.throttleEnabled,
		ipLimit: config.ipLimit as number,
		usernameLimit: config.usernameLimit as number,
		windowSeconds: config.windowSeconds as number,
	};

}

export function setLoginSecurity(value: LoginSecurityConfig): void {

	current = validateLoginSecurity(value);
	revision++;

}

export function getLoginSecurity(): { config: LoginSecurityConfig; revision: number } {
	return { config: { ...current }, revision };
}
