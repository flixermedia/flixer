import { describe, expect, it, vi } from "vitest";
import type { DataSource } from "typeorm";
import { MediaItem } from "../../entities/mediaItem.entity.js";
import { MediaCredit, personIdOf } from "../../entities/mediaCredit.entity.js";
import { PersonProfile } from "../../entities/personProfile.entity.js";
import type { IndexerClient } from "../indexer/indexerClient.js";
import type { AccessPolicy, MediaAccessService } from "../access/mediaAccessService.js";
import type { MediaSearchService } from "./mediaSearchService.js";
import { MediaHomeService } from "./mediaHomeService.js";

describe("MediaHomeService person images", () => {
	it("marks a cast photo available when an accessible credit has one", async () => {
		const name = "Known Actor";
		const id = personIdOf(name);
		const item = { id: "item", type: "series", title: "Show", images: [], metadata: { cast: [{ name, image: "/old/actor.jpg" }] } } as unknown as MediaItem;
		const children = { where: vi.fn().mockReturnThis(), andWhere: vi.fn().mockReturnThis(), orderBy: vi.fn().mockReturnThis(), addOrderBy: vi.fn().mockReturnThis(), getMany: vi.fn().mockResolvedValue([]) };
		const credits = { innerJoin: vi.fn().mockReturnThis(), select: vi.fn().mockReturnThis(), where: vi.fn().mockReturnThis(), getRawMany: vi.fn().mockResolvedValue([{ id }]) };
		const dataSource = { getRepository: vi.fn((entity: unknown) => entity === MediaItem ? { findOneBy: vi.fn().mockResolvedValue(item), createQueryBuilder: () => children } : entity === MediaCredit ? { createQueryBuilder: () => credits } : { findBy: vi.fn().mockResolvedValue([]) }) } as unknown as DataSource;
		const access = { blockReason: vi.fn().mockResolvedValue(null), restrict: vi.fn() } as unknown as MediaAccessService;
		const policy = {} as AccessPolicy;
		const service = new MediaHomeService(dataSource, {} as IndexerClient, {} as MediaSearchService, access);

		const result = await service.detail("item", undefined, policy);
		expect("cast" in result && result.cast).toEqual([{ id, name, role: null, hasImage: true }]);
		expect(access.restrict).toHaveBeenCalledWith(credits, "credited_item", policy, { content: true });
	});

	it("tries a provider fallback when the preferred image cannot be loaded", async () => {
		const name = "Fallback Actor";
		const id = personIdOf(name);
		const preferred = "https://image.tmdb.org/t/p/original/unavailable.jpg";
		const fallback = "https://artworks.thetvdb.com/fallback.jpg";
		const image = { data: Buffer.from("fallback image"), mime: "image/jpeg" };
		const credits = { where: vi.fn().mockReturnThis(), orderBy: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(), getMany: vi.fn().mockResolvedValue([{ image: preferred }]) };
		const items = { innerJoin: vi.fn().mockReturnThis(), select: vi.fn().mockReturnThis(), where: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(), getMany: vi.fn().mockResolvedValue([{ metadata: { cast: [{ name, fallbackImage: fallback }] } }]) };
		const dataSource = { getRepository: vi.fn((entity: unknown) => entity === MediaCredit ? { createQueryBuilder: () => credits } : entity === MediaItem ? { createQueryBuilder: () => items } : { findOneBy: vi.fn().mockResolvedValue(null) }) } as unknown as DataSource;
		const indexer = { fetchPersonImage: vi.fn().mockRejectedValueOnce(new Error("unavailable")).mockResolvedValueOnce(image) } as unknown as IndexerClient;
		const service = new MediaHomeService(dataSource, indexer, {} as MediaSearchService, {} as MediaAccessService);

		await expect(service.personImage(id)).resolves.toEqual(image);
		expect(indexer.fetchPersonImage).toHaveBeenNthCalledWith(1, id, preferred);
		expect(indexer.fetchPersonImage).toHaveBeenNthCalledWith(2, id, fallback);
	});

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

	it("looks up an artist portrait when no stored image exists", async () => {
		const id = "594da9b3-83da-0000-67b5-6dbe9f8c012c";
		const url = "https://i.discogs.com/artist-regression.jpg";
		const image = { data: Buffer.from("image bytes"), mime: "image/jpeg" };
		const query = {
			where: vi.fn().mockReturnThis(), orderBy: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(),
			getMany: vi.fn().mockResolvedValue([]), getOne: vi.fn().mockResolvedValue({ personId: id, name: "Artist" }),
		};
		const profile = {
			findOneBy: vi.fn().mockResolvedValue(null), create: vi.fn((row) => row), save: vi.fn().mockResolvedValue(undefined),
		};
		const dataSource = {
			getRepository: vi.fn((entity: unknown) => entity === MediaCredit ? { createQueryBuilder: () => query } : profile),
		} as unknown as DataSource;
		const indexer = { fetchPersonBio: vi.fn().mockResolvedValue({ imageUrl: url }), fetchPersonImage: vi.fn().mockResolvedValue(image) } as unknown as IndexerClient;
		const service = new MediaHomeService(dataSource, indexer, {} as MediaSearchService, {} as MediaAccessService);

		await expect(service.personImage(id, 128)).resolves.toEqual(image);
		expect(indexer.fetchPersonBio).toHaveBeenCalledWith("Artist", "artist");
		expect(indexer.fetchPersonImage).toHaveBeenCalledWith(id, url);
	});
});

describe("MediaHomeService artist browsing", () => {
	it("groups on the server, applies content restrictions, and deduplicates album artwork", async () => {
		const updatedAt = new Date("2026-01-01T00:00:00Z");
		const item = { id: "album-1", images: [{ type: "poster", path: "cover.jpg" }], updatedAt };
		const count = { select: vi.fn().mockReturnThis(), groupBy: vi.fn().mockReturnThis(), getRawOne: vi.fn().mockResolvedValue({ total: "3" }) };
		const groups = {
			innerJoin: vi.fn().mockReturnThis(), where: vi.fn().mockReturnThis(), select: vi.fn().mockReturnThis(),
			addSelect: vi.fn().mockReturnThis(), groupBy: vi.fn().mockReturnThis(), clone: vi.fn(() => count),
			orderBy: vi.fn().mockReturnThis(), addOrderBy: vi.fn().mockReturnThis(), offset: vi.fn().mockReturnThis(),
			limit: vi.fn().mockReturnThis(), getRawMany: vi.fn().mockResolvedValue([{ id: "artist-1", name: "Artist", albumCount: "1" }]),
		};
		const albums = {
			innerJoinAndMapOne: vi.fn().mockReturnThis(), where: vi.fn().mockReturnThis(), andWhere: vi.fn().mockReturnThis(),
			orderBy: vi.fn().mockReturnThis(), addOrderBy: vi.fn().mockReturnThis(),
			getMany: vi.fn().mockResolvedValue([{ personId: "artist-1", item }, { personId: "artist-1", item }]),
		};
		const builders = [groups, albums];
		const dataSource = { getRepository: vi.fn(() => ({ createQueryBuilder: () => builders.shift() })) } as unknown as DataSource;
		const access = { restrict: vi.fn() } as unknown as MediaAccessService;
		const policy = {} as AccessPolicy;
		const service = new MediaHomeService(dataSource, {} as IndexerClient, {} as MediaSearchService, access);

		await expect(service.browseArtists("title", 2, 1, policy)).resolves.toEqual({
			total: 3,
			items: [{ id: "artist-1", name: "Artist", albumCount: 1, covers: [{ itemId: "album-1", index: 0, version: updatedAt }] }],
		});
		expect(access.restrict).toHaveBeenCalledWith(groups, "item", policy, { content: true });
		expect(access.restrict).toHaveBeenCalledWith(albums, "item", policy, { content: true });
		expect(groups.offset).toHaveBeenCalledWith(2);
		expect(groups.limit).toHaveBeenCalledWith(1);
		expect(groups.orderBy).toHaveBeenCalledWith("MIN(credit.name)", "ASC");
		expect(albums.where).toHaveBeenCalledWith("credit.person_id IN (:...ids)", { ids: ["artist-1"] });
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
