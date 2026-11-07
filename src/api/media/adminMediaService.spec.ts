import { describe, expect, it, vi } from "vitest";
import type { DataSource } from "typeorm";
import type { IndexerClient } from "../indexer/indexerClient.js";
import type { MediaItem } from "../../entities/mediaItem.entity.js";
import { AdminMediaService } from "./adminMediaService.js";

describe("AdminMediaService", () => {
	it("shows the most-watched 13 items per section on the unfiltered overview", async () => {
		const query = vi.fn().mockResolvedValue([
			{
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
			},
		]);
		const dataSource = { query } as unknown as DataSource;
		const service = new AdminMediaService(dataSource, {} as IndexerClient);

		const result = await service.list({});

		expect(query).toHaveBeenCalledWith(expect.stringContaining("ROW_NUMBER() OVER"), [13]);
		expect(query.mock.calls[0]?.[0]).toContain("COUNT(*) AS watcher_count");
		expect(query.mock.calls[0]?.[0]).toContain("PARTITION BY section");
		expect(query.mock.calls[0]?.[0]).toContain("section_rank <= $1");
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
		} as MediaItem;
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
		} as MediaItem;
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
		} as MediaItem;
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
		} as MediaItem;
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
