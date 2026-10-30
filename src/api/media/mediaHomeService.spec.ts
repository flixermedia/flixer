import { describe, expect, it, vi } from "vitest";
import type { DataSource } from "typeorm";
import type { IndexerClient } from "../indexer/indexerClient.js";
import type { MediaSearchService } from "./mediaSearchService.js";
import { MediaHomeService } from "./mediaHomeService.js";

describe("MediaHomeService search ranking", () => {
	it("preserves Meilisearch ranking and returns only indexed hits", async () => {
		const rows = [
			{
				id: "spider",
				type: "movie",
				title: "Spider-Man: Far From Home",
				year: 2019,
				images: [],
				updatedAt: new Date(),
			},
			{
				id: "scream",
				type: "movie",
				title: "Scream",
				year: 1996,
				images: [],
				updatedAt: new Date(),
			},
		];
		const queryBuilder = {
			select: vi.fn().mockReturnThis(),
			where: vi.fn().mockReturnThis(),
			andWhere: vi.fn().mockReturnThis(),
			setParameter: vi.fn().mockReturnThis(),
			orderBy: vi.fn().mockReturnThis(),
			addOrderBy: vi.fn().mockReturnThis(),
			limit: vi.fn().mockReturnThis(),
			getMany: vi.fn().mockResolvedValue(rows),
		};
		const dataSource = {
			getRepository: vi.fn(() => ({ createQueryBuilder: () => queryBuilder })),
		} as unknown as DataSource;
		const mediaSearch = {
			searchIds: vi.fn().mockResolvedValue(["scream", "spider"]),
		} as unknown as MediaSearchService;
		const service = new MediaHomeService(dataSource, {} as IndexerClient, mediaSearch);

		const result = await service.search("user-1", "scream");

		expect(queryBuilder.andWhere).toHaveBeenCalledWith("item.id IN (:...searchIds)", {
			searchIds: ["scream", "spider"],
		});
		expect(result.items.map((item) => item.title)).toEqual(["Scream", "Spider-Man: Far From Home"]);
		expect(mediaSearch.searchIds).toHaveBeenCalledWith(
			"scream",
			expect.objectContaining({ type: ["movie", "series", "album", "video"] }),
		);
	});

	it("includes episodes only when the child-results filter is enabled", async () => {
		const queryBuilder = {
			select: vi.fn().mockReturnThis(),
			where: vi.fn().mockReturnThis(),
			andWhere: vi.fn().mockReturnThis(),
			orderBy: vi.fn().mockReturnThis(),
			addOrderBy: vi.fn().mockReturnThis(),
			limit: vi.fn().mockReturnThis(),
			getMany: vi.fn().mockResolvedValue([]),
		};
		const dataSource = {
			getRepository: vi.fn(() => ({ createQueryBuilder: () => queryBuilder })),
		} as unknown as DataSource;
		const mediaSearch = { searchIds: vi.fn().mockResolvedValue([]) } as unknown as MediaSearchService;
		const service = new MediaHomeService(dataSource, {} as IndexerClient, mediaSearch);

		await service.search("user-1", "pilot", { type: "series" });
		expect(mediaSearch.searchIds).toHaveBeenCalledWith(
			"pilot",
			expect.objectContaining({ type: ["series"] }),
		);

		await service.search("user-1", "pilot", { type: "series", includeChildren: true });
		expect(mediaSearch.searchIds).toHaveBeenLastCalledWith(
			"pilot",
			expect.objectContaining({ type: ["series", "episode"] }),
		);
	});

	it("includes all nested types when child results are enabled without a type filter", async () => {
		const queryBuilder = {
			select: vi.fn().mockReturnThis(),
			where: vi.fn().mockReturnThis(),
			andWhere: vi.fn().mockReturnThis(),
			orderBy: vi.fn().mockReturnThis(),
			addOrderBy: vi.fn().mockReturnThis(),
			limit: vi.fn().mockReturnThis(),
			getMany: vi.fn().mockResolvedValue([]),
		};
		const dataSource = {
			getRepository: vi.fn(() => ({ createQueryBuilder: () => queryBuilder })),
		} as unknown as DataSource;
		const mediaSearch = { searchIds: vi.fn().mockResolvedValue([]) } as unknown as MediaSearchService;
		const service = new MediaHomeService(dataSource, {} as IndexerClient, mediaSearch);

		await service.search("user-1", "lyrics", { includeChildren: true });

		expect(mediaSearch.searchIds).toHaveBeenCalledWith(
			"lyrics",
			expect.objectContaining({ type: ["movie", "series", "album", "video", "episode", "track"] }),
		);
	});
});
