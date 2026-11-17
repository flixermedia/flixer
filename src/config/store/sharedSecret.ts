import { randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { appConfig, type AppConfig } from "./appConfig.js";

const GENERATED_SECRET_BYTES = 48;

/**
 * The streamer and indexer need APP_SECRET before they can ask flixer for anything else. flixer therefore
 * publishes it to APP_SECRET_FILE, a file on a Docker volume shared only with those two containers.
 * It is world-readable inside that volume because the containers run as different users; do not mount the volume elsewhere.
 */
export function publishAppSecret(config: AppConfig = appConfig(), file = (process.env.APP_SECRET_FILE ?? process.env.STREAM_TOKEN_SECRET_FILE)?.trim()): boolean {
	const secret = config.get("appSecret");
	if (!file || !secret) {
		return false;
	}
	try {
		if (readFileSync(file, "utf8") === secret) {
			return true;
		}
	} catch {
		// Not written yet.
	}
	mkdirSync(dirname(file), { recursive: true });
	const temporary = `${file}.${process.pid}.tmp`;
	writeFileSync(temporary, secret, { mode: 0o644 });
	chmodSync(temporary, 0o644);
	renameSync(temporary, file);
	return true;
}

/**
 * Makes sure the JWT and app secrets exist: an environment value or saved one is kept as is, otherwise a random
 * one is generated and saved. Nothing is generated when the store cannot persist it, so a restart never changes a secret.
 */
export function ensureSecrets(config: AppConfig = appConfig()): void {
	const store = config.persistent;
	if (store) {
		const missing = (["jwtSecret", "appSecret"] as const).filter((name) => !config.get(name));
		if (missing.length > 0) {
			store.setMany(Object.fromEntries(missing.map((name) => [name, randomBytes(GENERATED_SECRET_BYTES).toString("base64url")])));
		}
	}
	publishAppSecret(config);
}
