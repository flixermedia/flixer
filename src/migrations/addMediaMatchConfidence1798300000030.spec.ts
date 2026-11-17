import { describe, expect, it, vi } from "vitest";
import { AddMediaMatchConfidence1798300000030 } from "./addMediaMatchConfidence1798300000030.ts";

describe("AddMediaMatchConfidence1798300000030", () => {
	it("adds an unknown legacy default and indexes reviewable items", async () => {
		const query = vi.fn();
		await new AddMediaMatchConfidence1798300000030().up({ query } as never);
		expect(query.mock.calls.map(([sql]) => sql)).toEqual(expect.arrayContaining([
			expect.stringContaining("DEFAULT 'unknown'"),
			expect.stringContaining("IDX_media_items_review_queue"),
		]));
	});

	it("can remove the confidence columns", async () => {
		const query = vi.fn();
		await new AddMediaMatchConfidence1798300000030().down({ query } as never);
		expect(query.mock.calls.map(([sql]) => sql)).toEqual(expect.arrayContaining([
			expect.stringContaining("DROP COLUMN IF EXISTS \"match_confidence\""),
			expect.stringContaining("DROP COLUMN IF EXISTS \"match_evidence\""),
		]));
	});
});