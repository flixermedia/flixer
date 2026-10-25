import { join, resolve } from "node:path";

export function dataPath(...segments: string[]): string {
	return join(resolve(process.env.DATA_PATH?.trim() || process.env.DATA_DIR?.trim() || "./data"), ...segments);
}

/** LOG_DIR when set, otherwise DATA_PATH/logs; undefined when no data folder is configured. */
export function logDirectory(): string | undefined {
	const explicit = process.env.LOG_DIR?.trim();
	if (explicit) return explicit;
	return process.env.DATA_PATH?.trim() || process.env.DATA_DIR?.trim() ? dataPath("logs") : undefined;
}
