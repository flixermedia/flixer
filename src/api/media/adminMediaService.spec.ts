import { describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import type { DataSource } from "typeorm";
import type { IndexerClient } from "../indexer/indexerClient.js";
import type { MediaItem } from "../../entities/mediaItem.entity.js";
import { MediaOrganizationSettings } from "../../entities/mediaOrganization.entity.js";
import { WatchProgress } from "../../entities/watchProgress.entity.js";
import { AdminMediaService } from "./adminMediaService.js";

describe("AdminMediaService", () => {
	it("refreshes resized artwork when the item changes but the image path stays the same", async () => {
		const item = {
			id: "00000000-0000-4000-8000-000000000001",
			images: [{ path: "/stable-poster.png" }],
			updatedAt: new Date("2026-01-01T00:00:00Z"),
		} as MediaItem;
		const image = async (red: number) =>
			sharp({ create: { width: 256, height: 256, channels: 3, background: { r: red, g: 0, b: 0 } } })
				.png()
				.toBuffer();
		const fetchImage = vi
			.fn()
			.mockResolvedValueOnce({ data: await image(0), contentType: "image/png" })
			.mockResolvedValueOnce({ data: await image(255), contentType: "image/png" });
		const dataSource = { getRepository: () => ({ findOneBy: vi.fn().mockResolvedValue(item) }) } as unknown as DataSource;
		const service = new AdminMediaService(dataSource, { fetchImage } as unknown as IndexerClient);
		const first = await service.image(item.id, 0, 64);
		item.updatedAt = new Date("2026-01-02T00:00:00Z");
		const second = await service.image(item.id, 0, 64);
		expect(fetchImage).toHaveBeenCalledTimes(2);
		expect(second.data.equals(first.data)).toBe(false);
	});

	it("finds matching source conflicts only within the item's library and type", async () => {
		const item = {
			id: "00000000-0000-4000-8000-000000000001",
			libraryId: "00000000-0000-4000-8000-000000000002",
			type: "series",
			providerIds: { tmdb: "42" },
		} as unknown as MediaItem;
		const query = vi.fn().mockResolvedValue([{ id: "other", title: "Other", path: "/tv/Other", providers: ["tmdb"] }]);
		const dataSource = { getRepository: () => ({ findOneBy: vi.fn().mockResolvedValue(item) }), query } as unknown as DataSource;
		const service = new AdminMediaService(dataSource, {} as IndexerClient);
		await expect(service.matchConflicts(item.id)).resolves.toEqual([{ id: "other", title: "Other", path: "/tv/Other", providers: ["tmdb"] }]);
		expect(query).toHaveBeenCalledWith(expect.stringContaining("other.library_id = $1 AND other.type = $2"), [item.libraryId, item.type, item.id, '{"tmdb":"42"}']);
		expect(query.mock.calls[0]?.[0]).toContain("NOT other.is_placeholder");
	});

	it("shows the most-watched 13 items per section on the unfiltered overview", async () => {
		const row = {
			id: "00000000-0000-4000-8000-000000000001",
			libraryId: "00000000-0000-4000-8000-000000000002",
			parentId: null,
			type: "movie",
			title: "Popular movie",
			year: 2020,
			seasonNumber: null,
			episodeNumber: null,
			path: "/movies/popular.mkv",
			providerIds: { tmdb: "1" },
			sizeBytes: "42",
			editedFields: [],
			images: [{ type: "poster", path: "/poster.jpg" }],
			updatedAt: new Date("2026-01-01T00:00:00Z"),
			parentTitle: null,
			total: "80",
			section: "movies",
			sectionTotal: "20",
		};
		const makeBuilder = (raw: unknown[] = []) => {
			const builder = { leftJoin: vi.fn(), innerJoin: vi.fn(), select: vi.fn(), addSelect: vi.fn(), where: vi.fn(), andWhere: vi.fn(), groupBy: vi.fn(), from: vi.fn(), orderBy: vi.fn(), addOrderBy: vi.fn(), addCommonTableExpression: vi.fn(), getRawMany: vi.fn().mockResolvedValue(raw) };
			for (const name of ["leftJoin", "innerJoin", "select", "addSelect", "where", "andWhere", "groupBy", "from", "orderBy", "addOrderBy", "addCommonTableExpression"] as const) builder[name].mockReturnValue(builder);
			return builder;
		};
		const watcherCounts = makeBuilder();
		const candidates = makeBuilder();
		const ranked = makeBuilder();
		const popular = makeBuilder([row]);
		const mediaRepository = { createQueryBuilder: vi.fn().mockReturnValueOnce(candidates).mockReturnValueOnce(popular) };
		const dataSource = { getRepository: vi.fn((entity: unknown) => (entity === WatchProgress ? { createQueryBuilder: () => watcherCounts } : mediaRepository)), createQueryBuilder: () => ranked } as unknown as DataSource;
		const service = new AdminMediaService(dataSource, {} as IndexerClient);

		const result = await service.list({});

		expect(watcherCounts.groupBy).toHaveBeenCalledWith("progress.itemId");
		expect(candidates.leftJoin).toHaveBeenCalledWith("watcher_counts", "watcher", "watcher.item_id = item.id");
		expect(ranked.addSelect).toHaveBeenCalledWith(expect.stringContaining("ROW_NUMBER() OVER (PARTITION BY candidate.section"), "section_rank");
		expect(popular.addCommonTableExpression).toHaveBeenNthCalledWith(1, watcherCounts, "watcher_counts");
		expect(popular.where).toHaveBeenCalledWith("ranked.section_rank <= :limit", { limit: 13 });
		expect(result).toMatchObject({
			page: 1,
			size: 13,
			total: 80,
			categoryCounts: { movies: 20, tvShows: 0, music: 0 },
			items: [
				{
					id: "00000000-0000-4000-8000-000000000001",
					title: "Popular movie",
					sizeBytes: 42,
					poster: 0,
					parentTitle: null,
				},
			],
		});
	});

	it("filters and counts only low-confidence or unidentified items in review mode", async () => {
		const item = {
			id: "00000000-0000-4000-8000-000000000001",
			libraryId: "00000000-0000-4000-8000-000000000002",
			parentId: null,
			type: "series",
			title: "My Series",
			year: 2001,
			seasonNumber: null,
			episodeNumber: null,
			path: "/tv/series",
			providerIds: { tmdb: "42" },
			matchConfidence: "high",
			matchEvidence: "title_year_match",
			sizeBytes: 42,
			editedFields: [],
			images: [],
			updatedAt: new Date("2026-01-01T00:00:00Z"),
		} as unknown as MediaItem;
		const builder = {
			leftJoin: vi.fn().mockReturnThis(),
			addSelect: vi.fn().mockReturnThis(),
			where: vi.fn().mockReturnThis(),
			andWhere: vi.fn().mockReturnThis(),
			orderBy: vi.fn().mockReturnThis(),
			addOrderBy: vi.fn().mockReturnThis(),
			offset: vi.fn().mockReturnThis(),
			limit: vi.fn().mockReturnThis(),
			getCount: vi.fn().mockResolvedValue(1),
			getRawAndEntities: vi.fn().mockResolvedValue({
				entities: [item],
				raw: [{ parentTitle: null }],
			}),
		};
		const categoryCounts = {
			select: vi.fn(),
			addSelect: vi.fn(),
			where: vi.fn(),
			andWhere: vi.fn(),
			groupBy: vi.fn(),
			getRawMany: vi.fn().mockResolvedValue([]),
		};
		for (const name of ["select", "addSelect", "where", "andWhere", "groupBy"] as const) categoryCounts[name].mockReturnValue(categoryCounts);
		const createQueryBuilder = vi.fn().mockReturnValueOnce(builder).mockReturnValueOnce(categoryCounts);
		const dataSource = { getRepository: () => ({ createQueryBuilder }) } as unknown as DataSource;
		const service = new AdminMediaService(dataSource, {} as IndexerClient);

		const result = await service.list({ reviewOnly: true });

		expect(builder.andWhere).toHaveBeenCalledWith(expect.stringContaining("EXISTS ("));
		expect(builder.andWhere).toHaveBeenCalledWith("item.parent_id IS NULL");
		expect(categoryCounts.andWhere).toHaveBeenCalledWith(expect.stringContaining("match_confidence IN ('low', 'unidentified', 'unknown')"));
		expect(result.items[0]).toMatchObject({ id: item.id, title: "My Series", matchConfidence: "high" });
	});

	it("updates provider IDs and tracks which IDs are manually controlled", async () => {
		const item = {
			id: "00000000-0000-4000-8000-000000000001",
			libraryId: "00000000-0000-4000-8000-000000000002",
			parentId: null,
			type: "movie",
			title: "Movie",
			providerIds: { tmdb: "1", imdb: "tt1" },
			editedFields: [],
			metadata: {},
			images: [],
			isPlaceholder: false,
		} as unknown as MediaItem;
		const repository = {
			findOneBy: vi.fn().mockResolvedValue(item),
			countBy: vi.fn().mockResolvedValue(0),
			save: vi.fn().mockResolvedValue(item),
		};
		const dataSource = { getRepository: vi.fn(() => repository) } as unknown as DataSource;
		const service = new AdminMediaService(dataSource, {} as IndexerClient);

		await service.update(item.id, { providerIds: { tmdb: " 42 ", imdb: null, custom: "custom-id" } });

		expect(item.providerIds).toEqual({ tmdb: "42", custom: "custom-id" });
		expect(item.editedFields).toEqual(expect.arrayContaining(["providerId:tmdb", "providerId:custom"]));
		expect(item.editedFields).not.toContain("providerId:imdb");
	});

	it("writes saved episode metadata and provider IDs to NFO when enabled for the library", async () => {
		const item = {
			id: "00000000-0000-4000-8000-000000000001",
			libraryId: "00000000-0000-4000-8000-000000000002",
			parentId: "season-id",
			type: "episode",
			path: "/shows/Series/Season 2/Series S02E03.mkv",
			title: "Episode",
			sortTitle: null,
			year: 2019,
			seasonNumber: 2,
			episodeNumber: 3,
			episodeEndNumber: null,
			providerIds: { imdb: "tt-old", tvdb: "old-tvdb" },
			editedFields: [],
			metadata: { overview: "Plot", premiereDate: "2019-10-24" },
			images: [],
			isPlaceholder: false,
		} as unknown as MediaItem;
		const itemRepository = {
			findOneBy: vi.fn().mockResolvedValue(item),
			countBy: vi.fn().mockResolvedValue(0),
			save: vi.fn().mockResolvedValue(item),
		};
		const settingsRepository = { findOneBy: vi.fn().mockResolvedValue({ nfoWritesEnabled: true }) };
		const request = vi.fn().mockResolvedValue({ written: true });
		const dataSource = {
			getRepository: (entity: unknown) => (entity === MediaOrganizationSettings ? settingsRepository : itemRepository),
		} as unknown as DataSource;
		const service = new AdminMediaService(dataSource, { request } as unknown as IndexerClient);

		await service.update(item.id, { providerIds: { imdb: "tt-fixed", tvdb: null } });

		expect(request).toHaveBeenCalledWith("POST", "/internal/nfo/write", {
			body: expect.objectContaining({
				libraryId: item.libraryId,
				itemType: "episode",
				path: item.path,
				fields: expect.objectContaining({ title: "Episode", year: "2019", season: "2", episode: "3", plot: "Plot" }),
				providerIds: { imdb: "tt-fixed" },
				clearProviderIds: ["tvdb"],
			}),
		});
	});

	it("does not write NFO when the library permission is disabled", async () => {
		const item = {
			id: "00000000-0000-4000-8000-000000000001",
			libraryId: "00000000-0000-4000-8000-000000000002",
			type: "movie",
			path: "/movies/Movie.mkv",
			title: "Movie",
			providerIds: { tmdb: "1" },
			editedFields: [],
			metadata: {},
			images: [],
			isPlaceholder: false,
		} as unknown as MediaItem;
		const itemRepository = { findOneBy: vi.fn().mockResolvedValue(item), countBy: vi.fn().mockResolvedValue(0), save: vi.fn().mockResolvedValue(item) };
		const settingsRepository = { findOneBy: vi.fn().mockResolvedValue({ nfoWritesEnabled: false }) };
		const request = vi.fn();
		const dataSource = { getRepository: (entity: unknown) => (entity === MediaOrganizationSettings ? settingsRepository : itemRepository) } as unknown as DataSource;
		const service = new AdminMediaService(dataSource, { request } as unknown as IndexerClient);

		await service.update(item.id, { title: "Corrected movie" });

		expect(request).not.toHaveBeenCalled();
	});

	it("keeps database edits when an enabled NFO write fails and reports the failure", async () => {
		const item = {
			id: "00000000-0000-4000-8000-000000000001",
			libraryId: "00000000-0000-4000-8000-000000000002",
			type: "movie",
			path: "/movies/Movie.mkv",
			title: "Movie",
			providerIds: {},
			editedFields: [],
			metadata: {},
			images: [],
			isPlaceholder: false,
		} as unknown as MediaItem;
		const itemRepository = { findOneBy: vi.fn().mockResolvedValue(item), countBy: vi.fn().mockResolvedValue(0), save: vi.fn().mockResolvedValue(item) };
		const settingsRepository = { findOneBy: vi.fn().mockResolvedValue({ nfoWritesEnabled: true }) };
		const request = vi.fn().mockRejectedValue(new Error("read-only mount"));
		const dataSource = { getRepository: (entity: unknown) => (entity === MediaOrganizationSettings ? settingsRepository : itemRepository) } as unknown as DataSource;
		const service = new AdminMediaService(dataSource, { request } as unknown as IndexerClient);

		const result = await service.update(item.id, { title: "Corrected movie" });

		expect(item.title).toBe("Corrected movie");
		expect(result).toMatchObject({ nfoWriteFailed: true });
	});

	it("saves sorted chapter edits as a persistent manual override", async () => {
		const item = {
			id: "00000000-0000-4000-8000-000000000001",
			libraryId: "00000000-0000-4000-8000-000000000002",
			parentId: null,
			type: "movie",
			title: "Movie",
			editedFields: [],
			metadata: { overview: "Keep me" },
			technical: { duration: 60 },
			images: [],
			isPlaceholder: false,
		} as unknown as MediaItem;
		const repository = {
			findOneBy: vi.fn().mockResolvedValue(item),
			countBy: vi.fn().mockResolvedValue(0),
			save: vi.fn().mockResolvedValue(item),
		};
		const dataSource = { getRepository: vi.fn(() => repository) } as unknown as DataSource;
		const service = new AdminMediaService(dataSource, {} as IndexerClient);

		await service.update(item.id, {
			chapters: [
				{ title: "00:00:30.000", startMs: 30000, endMs: 40000 },
				{ title: "First", startMs: 0, endMs: 20000 },
			],
		});

		expect(item.metadata).toEqual({
			overview: "Keep me",
			adminChapters: [
				{ title: "First", start: 0, end: 20 },
				{ title: "Chapter 2", start: 30, end: 40 },
			],
		});
		expect(item.editedFields).toContain("chapters");
		expect(repository.save).toHaveBeenCalledWith(item);
	});

	it("rejects overlapping or out-of-duration chapter ranges", async () => {
		const item = {
			id: "00000000-0000-4000-8000-000000000001",
			libraryId: "00000000-0000-4000-8000-000000000002",
			parentId: null,
			type: "movie",
			title: "Movie",
			editedFields: [],
			metadata: {},
			technical: { duration: 60 },
			images: [],
			isPlaceholder: false,
		} as unknown as MediaItem;
		const repository = {
			findOneBy: vi.fn().mockResolvedValue(item),
			countBy: vi.fn().mockResolvedValue(0),
			save: vi.fn().mockResolvedValue(item),
		};
		const dataSource = { getRepository: vi.fn(() => repository) } as unknown as DataSource;
		const service = new AdminMediaService(dataSource, {} as IndexerClient);

		await expect(
			service.update(item.id, {
				chapters: [
					{ title: "First", startMs: 0, endMs: 20000 },
					{ title: "Overlap", startMs: 10000, endMs: 30000 },
				],
			}),
		).rejects.toThrow("Chapter ranges cannot overlap.");
		await expect(
			service.update(item.id, {
				chapters: [{ title: "Too long", startMs: 50000, endMs: 61000 }],
			}),
		).rejects.toThrow("valid range within the media duration");
		expect(repository.save).not.toHaveBeenCalled();
	});

	it("queues a priority refresh with the item's saved provider IDs", async () => {
		const item = {
			id: "00000000-0000-4000-8000-000000000001",
			libraryId: "00000000-0000-4000-8000-000000000002",
			parentId: null,
			type: "movie",
			path: "/movies/movie.mkv",
			providerIds: { tmdb: "42" },
			isPlaceholder: false,
		} as unknown as MediaItem;
		const repository = { findOneBy: vi.fn().mockResolvedValue(item) };
		const request = vi.fn().mockResolvedValue({ queued: true, alreadyQueued: false });
		const dataSource = { getRepository: vi.fn(() => repository) } as unknown as DataSource;
		const service = new AdminMediaService(dataSource, { request } as unknown as IndexerClient);

		await service.refresh(item.id, true);

		expect(request).toHaveBeenCalledWith("POST", "/internal/refresh", {
			body: {
				libraryId: item.libraryId,
				path: item.path,
				itemType: item.type,
				priority: true,
				providerIds: { tmdb: "42" },
			},
		});
	});
});
