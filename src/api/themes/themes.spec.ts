import { describe, expect, it } from "vitest";
import { themeTaskFor } from "./themesService.js";

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
