import "reflect-metadata";
import { tryCatch } from "@dschz/try-catch";
import { $log } from "@tsed/logger";
import { PlatformFastify } from "@tsed/platform-fastify";
import { Server } from "./server.js";
import { freePortIfBusy } from "./utils/freePort.js";

async function startServer(): Promise<void> {

	await freePortIfBusy(Number(process.env.PORT || 8083), (message) => $log.warn(message));

	const [bootstrapError, platform] = await tryCatch(async () => {
		const platform = await PlatformFastify.bootstrap(Server);
		await platform.listen();
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
