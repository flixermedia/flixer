import { appender, BaseAppender, type LogEvent } from "@tsed/logger";
import { loggerExporter } from "./loggerExporter.js";
import { toUnifiedRecord } from "./unifiedLog.js";

export class LoggerAppender extends BaseAppender {
	write(event: LogEvent): void {
		try {
			loggerExporter.enqueue(toUnifiedRecord(event));
		} catch {
			process.stderr.write("Flixer logger: could not enqueue a log event\n");
		}
	}
}

appender("flixerLogger", LoggerAppender);
