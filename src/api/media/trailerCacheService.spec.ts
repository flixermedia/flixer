import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TrailerCacheService } from "./trailerCacheService.js";

const ID = "00000000-0000-4000-8000-000000000001";

describe("TrailerCacheService", () => {
	let directory: string;
	let originalPath: string | undefined;
	let originalDataPath: string | undefined;

	beforeEach(async () => {
		directory = await mkdtemp(join(tmpdir(), "flixer-trailer-test-"));
		const bin = join(directory, "bin");
		await mkdir(bin);
		const executable = join(bin, "yt-dlp");
		await writeFile(
			executable,
			`#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync(process.env.TEST_TRAILER_LOG, JSON.stringify(args) + "\\n");
if (process.env.TEST_TRAILER_FAIL === "1") process.exit(1);
if (process.env.TEST_TRAILER_SKIP === "1") process.exit(0);
if (args.includes("--get-url")) { console.log(process.env.TEST_TRAILER_URL || "https://r1.googlevideo.com/videoplayback?sig=ok"); process.exit(0); }
fs.appendFileSync(process.env.TEST_TRAILER_LOG + ".events", "start\\n");
setTimeout(() => { fs.writeFileSync(args[args.indexOf("-o") + 1], "fake video"); fs.appendFileSync(process.env.TEST_TRAILER_LOG + ".events", "end\\n"); }, 50);
`,
		);
		await chmod(executable, 0o755);
		originalPath = process.env.PATH;
		originalDataPath = process.env.DATA_PATH;
		process.env.PATH = `${bin}:${originalPath ?? ""}`;
		process.env.DATA_PATH = directory;
		process.env.TEST_TRAILER_LOG = join(directory, "calls");
	});

	afterEach(async () => {
		if (originalPath === undefined) delete process.env.PATH;
		else process.env.PATH = originalPath;
		if (originalDataPath === undefined) delete process.env.DATA_PATH;
		else process.env.DATA_PATH = originalDataPath;
		delete process.env.TEST_TRAILER_LOG;
		delete process.env.TEST_TRAILER_FAIL;
		delete process.env.TEST_TRAILER_SKIP;
		delete process.env.TEST_TRAILER_URL;
		await rm(directory, { recursive: true, force: true });
	});

	it("caches atomically, deduplicates concurrent downloads, and removes the cached file", async () => {
		const cache = new TrailerCacheService();
		expect(await cache.find(ID, "42")).toBeNull();
		await Promise.all([cache.download(ID, "42", "abcdefghijk"), cache.download(ID, "42", "abcdefghijk")]);
		const name = await cache.find(ID, "42");
		expect(name).toBe(`${ID}-42.mp4`);
		expect(await readFile(join(directory, "cache", "trailers", name!), "utf8")).toBe("fake video");
		const calls = (await readFile(join(directory, "calls"), "utf8")).trim().split("\n");
		expect(calls).toHaveLength(1);
		expect(JSON.parse(calls[0])).toContain("https://www.youtube.com/watch?v=abcdefghijk");
		expect(await readdir(join(directory, "cache", "trailers"))).toEqual([name]);
		await cache.remove(ID, "42");
		expect(await cache.find(ID, "42")).toBeNull();
		await expect(cache.remove(ID, "42")).rejects.toThrow("Cached trailer not found");
	});

	it("cleans up failed downloads and rejects unsafe identifiers", async () => {
		const cache = new TrailerCacheService();
		process.env.TEST_TRAILER_FAIL = "1";
		await expect(cache.download(ID, "42", "abcdefghijk")).rejects.toThrow("Trailer download failed");
		expect(await readdir(join(directory, "cache", "trailers"))).toEqual([]);
		await expect(cache.download(ID, "../42", "abcdefghijk")).rejects.toThrow("Invalid trailer identity");
		await expect(cache.download(ID, "42", "../invalid")).rejects.toThrow("Invalid trailer video ID");
	});

	it("queues additional distinct trailers without exceeding two active downloads", async () => {
		const cache = new TrailerCacheService();
		await Promise.all(["41", "42", "43"].map((id) => cache.download(ID, id, "abcdefghijk")));
		const events = (await readFile(join(directory, "calls.events"), "utf8")).trim().split("\n");
		let active = 0;
		let starts = 0;
		for (const event of events) {
			active += event === "start" ? 1 : -1;
			if (event === "start") starts++;
			expect(active).toBeLessThanOrEqual(2);
			expect(active).toBeGreaterThanOrEqual(0);
		}
		expect(starts).toBe(3);
		expect(active).toBe(0);
		for (const id of ["41", "42", "43"]) expect(await cache.find(ID, id)).not.toBeNull();
	});

	it("reports downloads that produce no eligible file without replacing an existing cache", async () => {
		const cache = new TrailerCacheService();
		await cache.download(ID, "42", "abcdefghijk");
		process.env.TEST_TRAILER_SKIP = "1";
		await expect(cache.download(ID, "42", "abcdefghijk")).rejects.toThrow("No eligible trailer file");
		expect(await readFile(join(directory, "cache", "trailers", `${ID}-42.mp4`), "utf8")).toBe("fake video");
		expect(await readdir(join(directory, "cache", "trailers"))).toEqual([`${ID}-42.mp4`]);
	});

	it("resolves only safe Google video URLs for remote playback", async () => {
		const cache = new TrailerCacheService();
		await expect(cache.remoteUrl("abcdefghijk")).resolves.toBe("https://r1.googlevideo.com/videoplayback?sig=ok");
		process.env.TEST_TRAILER_URL = "https://googlevideo.com.attacker.test/video";
		await expect(cache.remoteUrl("abcdefghijk")).rejects.toThrow("unsupported video URL");
	});

	it("reports when yt-dlp is missing instead of blaming the provider", async () => {
		await unlink(join(directory, "bin", "yt-dlp"));
		process.env.PATH = join(directory, "bin");
		await expect(new TrailerCacheService().remoteUrl("abcdefghijk")).rejects.toThrow("requires yt-dlp on the API server's PATH");
	});
});
