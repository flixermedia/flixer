import { DILoggerOptions } from "@tsed/di";
import { $log } from "@tsed/logger";
import "@tsed/logger-std";
import "@tsed/logger/layouts/JsonLayout.js";
import "../../logs/liveLogAppender.ts";
import "../../logs/loggerAppender.ts";
import "../../logs/unifiedLog.ts";
import { isProduction } from "../utils/index.ts";
import { alterRequestLog, logRequestResponse } from "./requestLog.ts";

// Mirrors log events to the admin dashboard's live log stream.
$log.appenders.set("live", { type: "live" });
$log.appenders.set("flixerLogger", { type: "flixerLogger" });

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
	disableRoutesSummary: true,
	alterLog: alterRequestLog,
	onLogResponse: logRequestResponse,
};
