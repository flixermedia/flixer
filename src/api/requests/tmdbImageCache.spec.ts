import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DiscogsImageCache, TmdbImageCache, cachedImageUrl, discogsImagePath, tmdbImagePath } from "./tmdbImageCache.js";

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);

describe("TmdbImageCache", () => {
	let dir: string;
	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), "tmdb-cache-"));
		process.env.DATA_PATH = dir;
	});
	afterEach(async () => {
		delete process.env.DATA_PATH;
		vi.restoreAllMocks();
		await rm(dir, { recursive: true, force: true });
	});

	it("rewrites TMDB urls to the cached route", () => {
		expect(cachedImageUrl("https://image.tmdb.org/t/p/w342/abc123.jpg")).toBe(tmdbImagePath("w342", "abc123.jpg"));
		expect(cachedImageUrl("https://example.com/a.jpg")).toBe("https://example.com/a.jpg");
		expect(cachedImageUrl(null)).toBeNull();
	});

	it("downloads once, stores under cache/tmdb and serves from disk afterwards", async () => {
		const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JPEG));
		const cache = new TmdbImageCache();
		const first = await cache.get("w342", "abc123.jpg");
		const second = await cache.get("w342", "abc123.jpg");
		expect(first.mime).toBe("image/jpeg");
		expect(second.data.equals(JPEG)).toBe(true);
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect((await readFile(join(dir, "cache", "tmdb", "w342", "abc123.jpg"))).equals(JPEG)).toBe(true);
	});

	it("rejects unknown sizes, traversal and non-image bodies", async () => {
		const cache = new TmdbImageCache();
		await expect(cache.get("w1", "abc123.jpg")).rejects.toThrow();
		await expect(cache.get("w342", "../../etc.jpg")).rejects.toThrow();
		vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("<html>"));
		await expect(cache.get("w342", "bad123.jpg")).rejects.toThrow();
	});

	it("caches Discogs images and only accepts Discogs image hosts", async () => {
		const url = "https://i.discogs.com/abc/rs:fit/g:sm/q:90/h:300/w:300/cover.jpeg";
		expect(discogsImagePath(url)).toBe(`/requests/images/discogs?u=${encodeURIComponent(url)}`);
		expect(discogsImagePath("https://evil.example/a.jpg")).toBeNull();
		expect(discogsImagePath("http://i.discogs.com/a.jpg")).toBeNull();
		expect(discogsImagePath("https://i.discogs.com@evil.example/a.jpg")).toBeNull();
		const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JPEG));
		const cache = new DiscogsImageCache();
		await cache.get(url);
		await cache.get(url);
		expect(fetchMock).toHaveBeenCalledTimes(1);
		await expect(cache.get("https://evil.example/a.jpg")).rejects.toThrow();
	});
});
