import { appConfig } from "../config/store/appConfig.js";
import { probeDatabase, type DatabaseProbe } from "./databaseProbe.js";
import { adoptEnvironmentInstall, adoptExistingUsers, updateRuntime } from "./setupStatus.js";

const MIN_DELAY_MS = 2000;
const MAX_DELAY_MS = 15000;

let wakeUp: (() => void) | undefined;

/** Skips the current wait; the setup steps call this right after saving a database connection. */
export function retryDatabaseNow(): void {
	wakeUp?.();
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => {
		const timer = setTimeout(done, ms);
		function done() {
			clearTimeout(timer);
			wakeUp = undefined;
			resolve();
		}
		wakeUp = done;
	});
}

/**
 * Waits until PostgreSQL is configured and reachable, probing with a growing delay, and reports progress through the
 * runtime state. It never changes a completed setup: an unreachable database just means "keep waiting".
 */
export async function waitForDatabase(log: (message: string) => void, probe: (url: string | undefined) => Promise<DatabaseProbe> = probeDatabase): Promise<void> {
	adoptEnvironmentInstall();
	let delay = MIN_DELAY_MS;
	let lastMessage = "";
	for (;;) {
		const result = await probe(appConfig().get("databaseUrl"));
		if (result.ok) {
			adoptExistingUsers(result.hasUsers);
			updateRuntime({ database: "ok" });
			return;
		}
		updateRuntime({ database: result.reason });
		if (result.message !== lastMessage) {
			log(`Waiting for PostgreSQL: ${result.message}`);
			lastMessage = result.message;
		}
		await sleep(delay);
		delay = Math.min(delay * 2, MAX_DELAY_MS);
	}
}
