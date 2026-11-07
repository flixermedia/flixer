import { afterEach, describe, expect, it, vi } from "vitest";
import { dataPath } from "./dataPath.js";

describe("dataPath", () => {
	afterEach(() => vi.unstubAllEnvs());

	it("resolves paths under DATA_PATH before DATA_DIR", () => {
		vi.stubEnv("DATA_PATH", "/data/legacy");
		vi.stubEnv("DATA_DIR", "/data/current");

		expect(dataPath("media", "movies")).toBe("/data/legacy/media/movies");
	});

	it("uses DATA_DIR when DATA_PATH is not configured", () => {
		vi.stubEnv("DATA_PATH", "");
		vi.stubEnv("DATA_DIR", "/data/current");

		expect(dataPath("media", "movies")).toBe("/data/current/media/movies");
	});
});
