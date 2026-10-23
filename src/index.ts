import "reflect-metadata";
import { tryCatch } from "@dschz/try-catch";
import { $log } from "@tsed/logger";
import { PlatformFastify } from "@tsed/platform-fastify";
import { startBootstrapServer, stopBootstrapServer } from "./bootstrap/bootstrapServer.js";
import { announceRecovery } from "./setup/recovery.js";
import { updateRuntime } from "./bootstrap/setupStatus.js";
import { waitForDatabase } from "./bootstrap/waitForDatabase.js";
import { ensureSecrets } from "./config/store/sharedSecret.js";
import { Server } from "./server.js";
import { freePortIfBusy } from "./utils/freePort.js";

async function startServer(): Promise<void> {

	const port = Number(process.env.PORT || 8083);
	await freePortIfBusy(port, (message) => $log.warn(message));

	// Until PostgreSQL is configured and reachable only the setup endpoints answer; the full app takes the port over afterwards.
	ensureSecrets();
	const bootstrapServer = await startBootstrapServer(port);
	announceRecovery((message) => $log.warn(message));
	await waitForDatabase((message) => $log.warn(message));
	await stopBootstrapServer(bootstrapServer);

	const [bootstrapError, platform] = await tryCatch(async () => {
		const platform = await PlatformFastify.bootstrap(Server);
		await platform.listen();
		updateRuntime({ mode: "ready" });
		return platform;
	});

	if (bootstrapError) {
		const err = bootstrapError instanceof Error ? bootstrapError : new Error(String(bootstrapError));
		$log.error({ event: "SERVER_BOOTSTRAP_ERROR", message: err.message, stack: err.stack });
		process.exitCode = 1;
		return;
	}

	const close = async () => {
		$log.warn("Stop server gracefully...");
		const [stopError] = await tryCatch(() => platform.stop());
		if (stopError) {
			console.error(stopError);
			process.exit(-1);
			return;
		}
		process.exit(0);
	};

	process.on("SIGINT", close);
	process.on("SIGTERM", close);

}

await startServer();
