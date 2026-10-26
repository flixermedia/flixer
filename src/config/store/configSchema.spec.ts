import { afterEach, describe, expect, it, vi } from "vitest";

describe("service defaults", () => {
	afterEach(() => {
		vi.unstubAllEnvs();
		vi.resetModules();
	});

	it("points the indexer and streamer at localhost in a Coder workspace but keeps the Postgres and Redis sidecar names", async () => {
		vi.stubEnv("CODER", "true");
		const { CONFIG_KEYS, suggestedDatabaseUrl, suggestedRedisUrl } = await import("./configSchema.js");
		expect(CONFIG_KEYS.indexerUrl.defaultValue).toBe("http://localhost:8092");
		expect(CONFIG_KEYS.streamerInternalUrl.defaultValue).toBe("http://localhost:8091");
		expect(suggestedRedisUrl()).toBe("redis://redis:6379");
		expect(suggestedDatabaseUrl()).toContain("@postgres:5432/");
	});
});
