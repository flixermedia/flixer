import { describe, expect, it, vi } from "vitest";
import type { DataSource } from "typeorm";
import { MediaItem } from "../../entities/mediaItem.entity.js";
import { MediaCredit } from "../../entities/mediaCredit.entity.js";
import { PersonProfile } from "../../entities/personProfile.entity.js";
import type { IndexerClient } from "../indexer/indexerClient.js";
import type { MediaSearchService } from "./mediaSearchService.js";
import { MediaHomeService } from "./mediaHomeService.js";

describe("MediaHomeService person images", () => {
	it.each(["credit", "profile"])("passes the normalized person ID to the indexer for a %s image", async (source) => {
		const id = "594da9b3-83da-0000-67b5-6dbe9f8c012c";
		const url = `https://image.tmdb.org/t/p/original/regression-${source}.jpg`;
		const image = { data: Buffer.from("image bytes"), mime: "image/jpeg" };
		const query = {
			where: vi.fn().mockReturnThis(),
			orderBy: vi.fn().mockReturnThis(),
			limit: vi.fn().mockReturnThis(),
			getMany: vi.fn().mockResolvedValue(source === "credit" ? [{ image: url }] : []),
		};
		const profile = { findOneBy: vi.fn().mockResolvedValue({ image: url }) };
		const dataSource = {
			getRepository: vi.fn((entity: unknown) => {
				if (entity === MediaCredit) return { createQueryBuilder: () => query };
				if (entity === PersonProfile) return profile;
				throw new Error("Unexpected repository");
			}),
		} as unknown as DataSource;
		const indexer = { fetchPersonImage: vi.fn().mockResolvedValue(image) } as unknown as IndexerClient;
		const service = new MediaHomeService(dataSource, indexer, {} as MediaSearchService);

		await expect(service.personImage(id.toUpperCase(), 128)).resolves.toEqual(image);
		expect(query.where).toHaveBeenCalledWith(
			"credit.person_id = :id AND credit.image IS NOT NULL",
			{ id },
		);
		expect(indexer.fetchPersonImage).toHaveBeenCalledOnce();
		expect(indexer.fetchPersonImage).toHaveBeenCalledWith(id, url);
		if (source === "profile") {
			expect(profile.findOneBy).toHaveBeenCalledWith({ personId: id });
		} else {
			expect(profile.findOneBy).not.toHaveBeenCalled();
		}
	});
});

describe("MediaHomeService search ranking", () => {
	it("returns recommendation cards in AI-ranked order and ignores missing ids", async () => {
		const items = [
			{
				id: "00000000-0000-4000-8000-000000000002",
				type: "movie",
				title: "Second",
				year: 2020,
				images: [],
				updatedAt: new Date("2020-01-01T00:00:00.000Z"),
			},
			{
				id: "00000000-0000-4000-8000-000000000001",
				type: "series",
				title: "First",
				year: 2021,
				images: [],
				updatedAt: new Date("2021-01-01T00:00:00.000Z"),
			},
		] as MediaItem[];
		const repository = { findBy: vi.fn().mockResolvedValue(items) };
		const dataSource = {
			getRepository: vi.fn(() => repository),
		} as unknown as DataSource;
		const service = new MediaHomeService(dataSource, {} as IndexerClient, {} as MediaSearchService);

		const cards = await service.cardsByIds([
			items[1].id,
			"00000000-0000-4000-8000-000000000003",
			items[0].id,
			items[1].id,
		]);

		expect(repository.findBy).toHaveBeenCalledOnce();
		expect(cards.map(({ title }) => title)).toEqual(["First", "Second"]);
	});

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
