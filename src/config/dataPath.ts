import { join, resolve } from "node:path";

export function dataPath(...segments: string[]): string {
	return join(resolve(process.env.DATA_PATH?.trim() || process.env.DATA_DIR?.trim() || "./data"), ...segments);
}
