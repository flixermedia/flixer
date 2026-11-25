import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { migrateCacheLayout } from "./cacheLayoutMigration.js";

describe("migrateCacheLayout", () => {
	const originalDataPath = process.env.DATA_PATH;
	let dir: string | undefined;

	afterEach(async () => {
		if (originalDataPath === undefined) delete process.env.DATA_PATH;
		else process.env.DATA_PATH = originalDataPath;
		if (dir) {
			await rm(dir, { recursive: true, force: true });
			dir = undefined;
		}
	});

	it("moves legacy cache folders into library/ and providers/ and updates DB paths", async () => {
		dir = await mkdtemp(join(tmpdir(), "cache-migrate-"));
		process.env.DATA_PATH = dir;
		const key = "0123456789abcdef0123456789abcdef";
		const itemId = "6d7b5b65-dc09-4b4f-960e-8602a97a90a8";
		const itemKey = createHash("sha256").update("root-1\nMovies/Movie.mkv").digest("hex").slice(0, 32);

		await mkdir(join(dir, "cache", "images", key, "manual"), { recursive: true });
		await writeFile(join(dir, "cache", "images", key, "folder.jpg"), "poster");
		await writeFile(join(dir, "cache", "images", key, "manual", "custom.png"), "manual");
		await mkdir(join(dir, "cache", "trickplay", key, "320"), { recursive: true });
		await writeFile(join(dir, "cache", "trickplay", key, "index.json"), "{}");
		await mkdir(join(dir, "cache", "subtitles", key), { recursive: true });
		await writeFile(join(dir, "cache", "subtitles", key, "en.vtt"), "WEBVTT");
		await mkdir(join(dir, "cache", "theme", key), { recursive: true });
		await writeFile(join(dir, "cache", "theme", key, "theme.mp3"), "mp3");
		await mkdir(join(dir, "cache", "lyrics"), { recursive: true });
		await writeFile(join(dir, "cache", "lyrics", "track-1.lrc"), "[00:01.00]hi");
		await mkdir(join(dir, "cache", "tmdb", "w342"), { recursive: true });
		await writeFile(join(dir, "cache", "tmdb", "w342", "abc.jpg"), "tmdb");
		await mkdir(join(dir, "cache", "discogs"), { recursive: true });
		await writeFile(join(dir, "cache", "discogs", "hash1"), "discogs");
		await mkdir(join(dir, "cache", "people"), { recursive: true });
		await writeFile(join(dir, "cache", "people", "p1.jpg"), "person");
		await mkdir(join(dir, "cache", "trailers"), { recursive: true });
		await writeFile(join(dir, "cache", "trailers", `${itemId}-42.mp4`), "trailer");

		const query = vi.fn(async (sql: string) => {
			if (sql.includes("SELECT id, root_id, relative_path")) {
				return [{ id: itemId, root_id: "root-1", relative_path: "Movies/Movie.mkv" }];
			}
			return [];
		});

		await migrateCacheLayout({ query } as never);

		expect(await readFile(join(dir, "cache", "library", key, "folder.jpg"), "utf8")).toBe("poster");
		expect(await readFile(join(dir, "cache", "library", key, "manual", "custom.png"), "utf8")).toBe("manual");
		expect(await readFile(join(dir, "cache", "library", key, "trickplay", "index.json"), "utf8")).toBe("{}");
		expect(await readFile(join(dir, "cache", "library", key, "subtitles", "en.vtt"), "utf8")).toBe("WEBVTT");
		expect(await readFile(join(dir, "cache", "library", key, "theme.mp3"), "utf8")).toBe("mp3");
		expect(await readFile(join(dir, "cache", "library", "lyrics", "track-1.lrc"), "utf8")).toBe("[00:01.00]hi");
		expect(await readFile(join(dir, "cache", "library", itemKey, "trailer-42.mp4"), "utf8")).toBe("trailer");
		expect(await readFile(join(dir, "cache", "providers", "tmdb", "w342", "abc.jpg"), "utf8")).toBe("tmdb");
		expect(await readFile(join(dir, "cache", "providers", "discogs", "hash1"), "utf8")).toBe("discogs");
		expect(await readFile(join(dir, "cache", "providers", "people", "p1.jpg"), "utf8")).toBe("person");
		await expect(stat(join(dir, "cache", "images"))).rejects.toThrow();
		await expect(stat(join(dir, "cache", "tmdb"))).rejects.toThrow();
		expect(query).toHaveBeenCalledWith(expect.stringContaining("UPDATE media_items"));
	});
});
