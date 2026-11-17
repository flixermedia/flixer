import { appender, BaseAppender, type LogEvent } from "@tsed/logger";
import { liveLogHub } from "./liveLogHub.js";
import { toUnifiedRecord } from "./unifiedLog.js";

/** Logger appender that mirrors every log event into the live log hub. */
export class LiveLogAppender extends BaseAppender {

	write(event: LogEvent): void {
		const { time, level, app, source, message, ...fields } = toUnifiedRecord(event);
		liveLogHub.publish({ time, level, app, source, message, fields });
	}
}

appender("live", LiveLogAppender);
