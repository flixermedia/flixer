import { randomBytes, timingSafeEqual } from "node:crypto";
import { appConfig, type AppConfig } from "../config/store/appConfig.js";
import { runtimeState } from "../bootstrap/setupStatus.js";

export const RECOVERY_CODE_HEADER = "x-setup-recovery-code";

// No 0/O/1/I/L so the code can be read from a log and typed without guessing.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const MAX_FAILURES = 10;
const FAILURE_WINDOW_MS = 10 * 60 * 1000;

let code: string | undefined;
let failures: number[] = [];

/**
 * Setup was completed, but this process has no database to run on: the connection was only ever in the environment
 * (or the saved value is gone). Nobody can sign in, so an administrator cannot unlock setup. Instead the person who
 * can read the server's log, which is where the recovery code is printed, may reconnect the database.
 */
export function needsRecovery(config: AppConfig = appConfig()): boolean {
	return config.persistent?.setupState() === "completed" && runtimeState().mode === "bootstrap" && !config.get("databaseUrl");
}

/** Created on first use and kept only in memory, so every start of the server prints a fresh code. */
export function recoveryCode(): string {
	if (!code) {
		const bytes = randomBytes(16);
		const letters = Array.from(bytes, (byte) => ALPHABET[byte % ALPHABET.length]).join("");
		code = letters.match(/.{4}/g)!.join("-");
	}
	return code;
}

export type RecoveryCheck = "ok" | "invalid" | "throttled";

export function checkRecoveryCode(candidate: string | undefined, now = Date.now()): RecoveryCheck {
	failures = failures.filter((at) => now - at < FAILURE_WINDOW_MS);
	if (failures.length >= MAX_FAILURES) {
		return "throttled";
	}
	const expected = Buffer.from(recoveryCode());
	const given = Buffer.from((candidate ?? "").trim().toUpperCase());
	if (given.length === expected.length && timingSafeEqual(given, expected)) {
		return "ok";
	}
	failures.push(now);
	return "invalid";
}

/** Prints the code when recovery is needed. Returns whether it did, so callers and tests can tell. */
export function announceRecovery(write: (message: string) => void, config: AppConfig = appConfig()): boolean {
	if (!needsRecovery(config)) {
		return false;
	}
	write(`Setup is marked complete but no database is configured. Open the Flixer web app and enter this recovery code to reconnect a database: ${recoveryCode()}`);
	return true;
}

const REQUEST_INTERVAL_MS = 15_000;
let lastRequest = 0;

/**
 * Writes the recovery key to the server log on request, so someone locked out of setup who can read the log can get in
 * without the key sitting in the log of every normal start. Asking again within a few seconds does nothing.
 */
export function logRecoveryKey(write: (message: string) => void, now = Date.now()): boolean {
	if (now - lastRequest < REQUEST_INTERVAL_MS) {
		return false;
	}
	lastRequest = now;
	write(`Setup recovery key requested from the setup screen. Enter this key there to continue setup: ${recoveryCode()}`);
	return true;
}

export function resetRecoveryForTests(): void {
	code = undefined;
	failures = [];
	lastRequest = 0;
}
