import { describe, expect, it, vi } from "vitest";
import { AddMediaItemContentHash1798300000033 } from "./addMediaItemContentHash1798300000033.js";

describe("AddMediaItemContentHash1798300000033", () => {
	it("adds an indexed nullable SHA-256 column", async () => {
		const query = vi.fn();
		await new AddMediaItemContentHash1798300000033().up({ query } as never);
		expect(query.mock.calls[0]?.[0]).toContain('"content_hash" char(64)');
		expect(query.mock.calls[1]?.[0]).toContain("IDX_media_items_content_hash");
	});

	it("removes the hash index and column", async () => {
		const query = vi.fn();
		await new AddMediaItemContentHash1798300000033().down({ query } as never);
		expect(query.mock.calls[0]?.[0]).toContain("DROP INDEX IF EXISTS");
		expect(query.mock.calls[1]?.[0]).toContain('DROP COLUMN IF EXISTS "content_hash"');
	});
});
