import { describe, expect, it, vi } from "vitest";
import type { QueryRunner } from "typeorm";
import { AddTrailerCacheSetting1798300000003 } from "./addTrailerCacheSetting1798300000003.js";

describe("trailer cache setting migration", () => {
	it("inserts a private disabled setting without overwriting an existing value", async () => {
		const query = vi.fn().mockResolvedValue(undefined);
		const runner = { query } as unknown as QueryRunner;
		const migration = new AddTrailerCacheSetting1798300000003();

		await migration.up(runner);
		expect(query).toHaveBeenCalledWith(expect.stringMatching(/VALUES\s*\('trailers_cache_enabled',\s*'false'::jsonb,\s*false\)/));
		expect(query).toHaveBeenCalledWith(expect.stringContaining('ON CONFLICT ("key") DO NOTHING'));
		await migration.down(runner);
		expect(query).toHaveBeenLastCalledWith(`DELETE FROM "settings" WHERE "key" = 'trailers_cache_enabled'`);
	});
});
