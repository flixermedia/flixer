import { open, stat } from "node:fs/promises";
import { join } from "node:path";
import { type LiveLogEntry, type LiveLogHub, type LiveLogLevel } from "./liveLogHub.js";

const POLL_MS = 500;
const INITIAL_TAIL_BYTES = 32 * 1024;
const MAX_READ_BYTES = 1024 * 1024;
const MAX_MESSAGE = 4000;
const STREAMER_LOG_FILE = "streamer.log";

function toLevel(value: unknown): LiveLogLevel {
	const level = typeof value === "string" ? value.toLowerCase() : "";
	if (level.startsWith("err")) return "error";
	if (level.startsWith("warn")) return "warn";
	if (level.startsWith("debug")) return "debug";
	return "info";
}

/** Reads one shared-schema log line; foreign (non-JSON) lines become plain info text. */
export function parseStreamerLine(line: string): Omit<LiveLogEntry, "id" | "app"> & { app?: string } | undefined {
	const text = line.trim();
	if (!text) return undefined;

	try {
		const { time, level, app, source, message, ...fields } = JSON.parse(text) as Record<string, unknown>;
		const parsed = typeof time === "string" ? new Date(time) : new Date();
		return {
			time: Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString(),
			level: toLevel(level),
			app: typeof app === "string" ? app : undefined,
			source: typeof source === "string" ? source : "",
			message: (typeof message === "string" ? message : "").slice(0, MAX_MESSAGE),
			fields,
		};
	} catch {
		return { time: new Date().toISOString(), level: "info", source: "", message: text.slice(0, MAX_MESSAGE) };
	}
}

/**
 * Follows the streamer's JSON log file and republishes each new line to the live log hub.
 * It polls rather than using fs.watch so it keeps working across rotation and on shared volumes.
 */
export class StreamerLogTailer {

	private readonly file: string;
	private timer?: NodeJS.Timeout;
	private offset = -1;
	private remainder = Buffer.alloc(0);
	private polling = false;

	constructor(
		logDir: string,
		private readonly hub: LiveLogHub,
		private readonly source = "flixer-streamer",
	) {
		this.file = join(logDir, STREAMER_LOG_FILE);
	}

	start(): void {
		if (this.timer) return;
		this.timer = setInterval(() => void this.poll(), POLL_MS);
		this.timer.unref();
		void this.poll();
	}

	stop(): void {
		clearInterval(this.timer);
		this.timer = undefined;
	}

	async poll(): Promise<void> {
		if (this.polling) return;
		this.polling = true;
		try {
			await this.readNew();
		} catch {
			// The file may not exist yet or be mid-rotation; try again on the next tick.
		} finally {
			this.polling = false;
		}
	}

	private async readNew(): Promise<void> {
		const { size } = await stat(this.file);

		if (this.offset < 0) {
			this.offset = Math.max(0, size - INITIAL_TAIL_BYTES);
			// Starting mid-file means the first line is probably cut off.
			if (this.offset > 0) this.remainder = Buffer.alloc(0);
			await this.read(size, this.offset > 0);
			return;
		}

		if (size < this.offset) {
			// Rotated or truncated: start over from the top of the new file.
			this.offset = 0;
			this.remainder = Buffer.alloc(0);
		}
		if (size > this.offset) {
			await this.read(size, false);
		}
	}

	private async read(size: number, dropFirstLine: boolean): Promise<void> {
		const handle = await open(this.file, "r");
		try {
			const length = Math.min(size - this.offset, MAX_READ_BYTES);
			const chunk = Buffer.alloc(length);
			const { bytesRead } = await handle.read(chunk, 0, length, this.offset);
			this.offset += bytesRead;

			let data = Buffer.concat([this.remainder, chunk.subarray(0, bytesRead)]);
			if (dropFirstLine) {
				const newline = data.indexOf(0x0a);
				data = newline === -1 ? Buffer.alloc(0) : data.subarray(newline + 1);
			}

			const lastNewline = data.lastIndexOf(0x0a);
			if (lastNewline === -1) {
				this.remainder = data;
				return;
			}
			this.remainder = Buffer.from(data.subarray(lastNewline + 1));

			for (const line of data.subarray(0, lastNewline).toString("utf8").split("\n")) {
				const entry = parseStreamerLine(line);
				if (entry) this.hub.publish({ ...entry, app: entry.app ?? this.source, source: entry.source || this.source });
			}
		} finally {
			await handle.close();
		}
	}
}
