import { describe, expect, it, vi } from "vitest";
import type { DataSource } from "typeorm";
import { DuplicateSuggestionsService } from "./duplicateSuggestionsService.js";

describe("DuplicateSuggestionsService", () => {
	it("returns paginated exact provider identity groups with bounded item details", async () => {
		const query = vi.fn().mockResolvedValue([
			{
				library_id: "library-1",
				type: "movie",
				kind: "providerId",
				provider: "tmdb",
				provider_id: "42",
				item_count: "12",
				items_truncated: true,
				items: [{ id: "item-1", title: "First", year: 2000, path: "/media/first.mkv" }],
				total: "3",
			},
			{
				library_id: "library-1",
				type: "movie",
				kind: "fileHash",
				provider: "SHA-256",
				provider_id: "a".repeat(64),
				item_count: "2",
				items_truncated: false,
				items: [{ id: "item-2", title: "Copy", year: 2000, path: "/media/copy.mkv" }],
				total: "3",
			},
		]);
		const service = new DuplicateSuggestionsService({ query } as unknown as DataSource);

		await expect(service.list({ page: 2, size: 25 })).resolves.toEqual({
			items: [
				{
					libraryId: "library-1",
					type: "movie",
					kind: "providerId",
					provider: "tmdb",
					providerId: "42",
					itemCount: 12,
					itemsTruncated: true,
					items: [{ id: "item-1", title: "First", year: 2000, path: "/media/first.mkv" }],
				},
				{
					libraryId: "library-1",
					type: "movie",
					kind: "fileHash",
					provider: "SHA-256",
					providerId: "a".repeat(64),
					itemCount: 2,
					itemsTruncated: false,
					items: [{ id: "item-2", title: "Copy", year: 2000, path: "/media/copy.mkv" }],
				},
			],
			total: 3,
			page: 2,
			size: 25,
		});
		expect(query.mock.calls[0]?.[0]).toContain("provider.key AS provider, provider.value AS provider_id");
		expect(query.mock.calls[0]?.[0]).toContain("item.is_placeholder = false");
		expect(query.mock.calls[0]?.[0]).toContain("lower(provider.key) <> 'tmdbset'");
		expect(query.mock.calls[0]?.[0]).toContain("GROUP BY library_id, type, kind, provider, provider_id");
		expect(query.mock.calls[0]?.[0]).not.toMatch(/title\s*,\s*year\s+HAVING/i);
		expect(query.mock.calls[0]?.[1]).toEqual([25, 25, 10]);
	});

	it("applies default and maximum page bounds", async () => {
		const query = vi.fn().mockResolvedValue([{ library_id: null, total: 0 }]);
		const service = new DuplicateSuggestionsService({ query } as unknown as DataSource);

		await expect(service.list({ page: -1, size: 500 })).resolves.toMatchObject({ items: [], total: 0, page: 1, size: 100 });
		expect(query.mock.calls[0]?.[1]).toEqual([0, 100, 10]);
	});
});
