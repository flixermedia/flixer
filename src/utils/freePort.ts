import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";

const KILL_SCRIPT = join(process.cwd(), "scripts", "kill-port.mjs");
const RETRIES = 10;
const RETRY_DELAY_MS = 300;

function isPortFree(port: number): Promise<boolean> {
	return new Promise((resolve) => {
		const probe = createServer();
		probe.once("error", (error: NodeJS.ErrnoException) => resolve(error.code !== "EADDRINUSE"));
		probe.once("listening", () => probe.close(() => resolve(true)));
		probe.listen(port);
	});
}

/**
 * In development, stops whatever is already listening on the port (usually a previous run of this server)
 * using scripts/kill-port.mjs. Does nothing in production or when the script is not present.
 */
export async function freePortIfBusy(port: number, log: (message: string) => void): Promise<void> {
	if (process.env.NODE_ENV === "production" || !Number.isInteger(port) || (await isPortFree(port))) {
		return;
	}
	if (!existsSync(KILL_SCRIPT)) {
		return;
	}

	log(`Port ${port} is already in use. Running the kill-port script...`);
	try {
		execFileSync(process.execPath, [KILL_SCRIPT, String(port)], { stdio: "inherit" });
	} catch {
		log(`kill-port could not free port ${port}.`);
		return;
	}

	for (let attempt = 0; attempt < RETRIES; attempt++) {
		if (await isPortFree(port)) {
			return;
		}
		await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
	}
}
