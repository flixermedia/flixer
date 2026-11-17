import { describe, expect, it, vi } from "vitest";
import { AddMediaLibraryWritePermissions1798300000034 } from "./addMediaLibraryWritePermissions1798300000034.ts";

describe("AddMediaLibraryWritePermissions1798300000034", () => {
	it("adds separate default-off organization and NFO write permissions", async () => {
		const query = vi.fn();
		await new AddMediaLibraryWritePermissions1798300000034().up({ query } as never);
		expect(query.mock.calls[0]?.[0]).toContain('"organization_writes_enabled" boolean NOT NULL DEFAULT false');
		expect(query.mock.calls[1]?.[0]).toContain('"nfo_writes_enabled" boolean NOT NULL DEFAULT false');
	});

	it("removes both permission fields on rollback", async () => {
		const query = vi.fn();
		await new AddMediaLibraryWritePermissions1798300000034().down({ query } as never);
		expect(query.mock.calls.map(([sql]) => sql)).toEqual(expect.arrayContaining([
			expect.stringContaining('DROP COLUMN IF EXISTS "nfo_writes_enabled"'),
			expect.stringContaining('DROP COLUMN IF EXISTS "organization_writes_enabled"'),
		]));
	});
});