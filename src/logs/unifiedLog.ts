import { BaseLayout, layout, type LogEvent } from "@tsed/logger";
import { inspect } from "node:util";

/**
 * The log line shared by every Flixer app (flixer, flixer-streamer):
 * `{ time, level, app, source, message, ...fields }`, one JSON object per line.
 * `level` is lowercase (debug | info | warn | error), `source` is the component
 * that logged it, and any structured fields sit flat beside them.
 */
export interface UnifiedLogRecord {
	time: string;
	level: "debug" | "info" | "warn" | "error";
	app: string;
	source: string;
	message: string;
	[field: string]: unknown;
}

export const APP_NAME = "flixer";

const MAX_MESSAGE_LENGTH = 4_000;
// eslint-disable-next-line no-control-regex
const ANSI_PATTERN = /\u001b\[[0-9;]*m|\u001b/g;
const RESERVED_FIELDS = new Set(["time", "startTime", "level", "app", "source", "message", "categoryName", "data"]);

function toLevel(levelStr: string): UnifiedLogRecord["level"] {
	switch (levelStr.toLowerCase()) {
		case "warn":
			return "warn";
		case "error":
		case "fatal":
			return "error";
		case "info":
			return "info";
		default:
			return "debug";
	}
}

function formatItem(item: unknown): string {
	if (typeof item === "string") {
		return item;
	}
	if (item instanceof Error) {
		return item.stack ?? item.message;
	}
	return inspect(item, { depth: 4, breakLength: Infinity });
}

/** Joins log arguments into one plain-text line (no colours, bounded length). */
export function formatLogMessage(data: unknown[]): string {
	const message = data.map(formatItem).join(" ").replace(ANSI_PATTERN, "").trim();
	return message.length > MAX_MESSAGE_LENGTH ? `${message.slice(0, MAX_MESSAGE_LENGTH)}…` : message;
}

/** Builds the shared log record from a Ts.ED logger event. */
export function toUnifiedRecord(event: LogEvent): UnifiedLogRecord {
	const text: unknown[] = [];
	const fields: Record<string, unknown> = { ...event.context.toJSON() };

	for (const item of event.data) {
		if (item instanceof Error || item === null || typeof item !== "object") {
			text.push(item);
		} else {
			const { data, ...rest } = item as Record<string, unknown>;
			Object.assign(fields, rest);
			if (Array.isArray(data)) {
				text.push(...data);
			}
		}
	}

	let message = formatLogMessage(text);
	if (!message && typeof fields.event === "string") {
		message = fields.event;
	}

	const extra: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(fields)) {
		if (!RESERVED_FIELDS.has(key) && value !== undefined) {
			extra[key] = value;
		}
	}

	return {
		time: event.startTime.toISOString(),
		level: toLevel(event.level.levelStr),
		app: APP_NAME,
		source: event.categoryName,
		message,
		...extra,
	};
}

/** Layout that writes {@link UnifiedLogRecord} JSON lines. */
export class UnifiedLayout extends BaseLayout {

	transform(event: LogEvent): string {
		return JSON.stringify(toUnifiedRecord(event));
	}
}

layout("unified", UnifiedLayout);
