import { appender, BaseAppender, type LogEvent } from "@tsed/logger";
import { loggerExporter } from "./loggerExporter.ts";
import { toUnifiedRecord } from "./unifiedLog.ts";

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
