import { describe, expect, it, vi } from "vitest";
import type { DataSource } from "typeorm";
import { MediaLibrary } from "../../entities/mediaLibrary.entity.js";
import { Setting } from "../../entities/setting.entity.js";
import type { IndexerClient } from "../indexer/indexerClient.js";
import { ThemesService, themeTaskFor } from "./themesService.js";

describe("themeTaskFor", () => {
	const base = {
		libraryId: "lib",
		path: "/media/Movies/The Matrix (1999)/matrix.mkv",
		rootId: "root",
		relativePath: "Movies/The Matrix (1999)/matrix.mkv",
	};

	it("maps TMDB-identified movies and series", () => {
		expect(themeTaskFor({ ...base, type: "movie", externalKey: "tmdb:603" })).toEqual({
			libraryId: "lib",
			path: base.path,
			rootId: "root",
			relativePath: base.relativePath,
			itemType: "movie",
			tmdbId: "603",
		});

		expect(themeTaskFor({ ...base, type: "series", externalKey: "tmdb:1399" })?.itemType).toBe("series");
	});

	it("skips episodes, unidentified items and other providers", () => {
		expect(themeTaskFor({ ...base, type: "episode", externalKey: "tmdb:1399:s1:e2" })).toBeNull();
		expect(themeTaskFor({ ...base, type: "movie", externalKey: "path:/media/x.mkv" })).toBeNull();
		expect(themeTaskFor({ ...base, type: "movie", externalKey: "tvdb:81189" })).toBeNull();
		expect(themeTaskFor({ ...base, type: "movie", externalKey: "tmdb:603:extra" })).toBeNull();
		expect(themeTaskFor({ ...base, rootId: null, type: "movie", externalKey: "tmdb:603" })).toBeNull();
	});
});

describe("ThemesService.syncAll", () => {
	it("limits queued theme candidates to the selected library", async () => {
		const itemId = "97a37f33-0fd0-4bfc-a0b0-55ef759d9da2";
		const query = {
			where: vi.fn().mockReturnThis(),
			andWhere: vi.fn().mockReturnThis(),
			orderBy: vi.fn().mockReturnThis(),
			take: vi.fn().mockReturnThis(),
			getMany: vi.fn().mockResolvedValue([]),
		};
		const dataSource = {
			getRepository(entity: unknown) {
				if (entity === Setting) return { findOneBy: async () => ({ value: true }) };
				if (entity === MediaLibrary) return { existsBy: async () => true };
				return { createQueryBuilder: () => query };
			},
		} as unknown as DataSource;
		const service = new ThemesService(dataSource, {} as IndexerClient);

		await service.syncAll(itemId);

		expect(query.andWhere).toHaveBeenCalledWith("item.library_id = :libraryId", { libraryId: itemId });
	});
});
