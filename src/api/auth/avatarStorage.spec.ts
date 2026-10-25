import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getAvatarDirectory } from "./avatarStorage.js";

describe("avatar storage", () => {
	const originalDataPath = process.env.DATA_PATH;
	let dataPath: string | undefined;

	afterEach(() => {
		if (originalDataPath === undefined) {
			delete process.env.DATA_PATH;
		} else {
			process.env.DATA_PATH = originalDataPath;
		}
		if (dataPath) {
			rmSync(dataPath, { recursive: true, force: true });
			dataPath = undefined;
		}
	});

	it("stores avatars under DATA_PATH/avatars", () => {
		dataPath = mkdtempSync(join(tmpdir(), "flixer-data-"));
		process.env.DATA_PATH = dataPath;
		expect(getAvatarDirectory()).toBe(join(dataPath, "avatars"));
	});
});
