import { DILoggerOptions } from "@tsed/di";
import { $log } from "@tsed/logger";
import "@tsed/logger-file";
import "@tsed/logger-std";
import "@tsed/logger/layouts/JsonLayout.js";
import { config as loadDotEnv } from "dotenv";
import { join } from "node:path";
import "../../logs/liveLogAppender.js";
import "../../logs/unifiedLog.js";
import { isProduction } from "../utils/index.js";

// This module is evaluated before Ts.ED loads .env, so read LOG_DIR from it directly.
loadDotEnv({ quiet: true });

const LOG_FILE_MAX_BYTES = 10 * 1024 * 1024;
const LOG_FILE_BACKUPS = 3;

// Mirrors log events to the admin dashboard's live log stream.
$log.appenders.set("live", { type: "live" });

// JSON lines in LOG_DIR let Alloy ship the logs to Loki without Docker; console output is unchanged.
if (process.env.LOG_DIR) {
	$log.appenders.set("file", {
		type: "file",
		filename: join(process.env.LOG_DIR, "flixer.log"),
		maxLogSize: LOG_FILE_MAX_BYTES,
		backups: LOG_FILE_BACKUPS,
		layout: {
			type: "unified",
		},
	});
}

if (isProduction) {
	$log.appenders.set("stdout", {
		type: "stdout",
		levels: ["info", "debug"],
		layout: {
			type: "unified",
		},
	});

	$log.appenders.set("stderr", {
		levels: ["trace", "fatal", "error", "warn"],
		type: "stderr",
		layout: {
			type: "unified",
		},
	});
}

export default <DILoggerOptions>{
	disableRoutesSummary: isProduction,
};
