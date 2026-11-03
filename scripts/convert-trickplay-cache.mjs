#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { linkSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function usage() {
	console.log(`Convert cached Flixer trickplay indexes into HLS image playlists.

Usage:
  node scripts/convert-trickplay-cache.mjs [--data-dir <path>] [--write] [--force]

Options:
  --data-dir <path>  Flixer data directory (defaults to DATA_DIR in the environment or .env)
  --write            Write playlists; without this option, only report what would change
  --force            Replace existing tiles.m3u8 files (only with --write)
  --help             Show this help

Each playlist is written beside its existing index.json and JPEG sheets. Original files
are kept so older Flixer versions can continue using the cache.`);
}

function readDataDirFromDotEnv() {
	try {
		const contents = readFileSync(path.join(repoDir, ".env"), "utf8");
		for (const line of contents.split(/\r?\n/)) {
			const match = line.match(/^\s*DATA_DIR\s*=\s*(.*?)\s*$/);
			if (!match) continue;
			const value = match[1].replace(/^(['"])(.*)\1$/, "$2").trim();
			if (value) return path.resolve(repoDir, value);
		}
	} catch (error) {
		if (error.code !== "ENOENT") throw error;
	}
	return path.join(repoDir, "data");
}

function parseArgs(args) {
	let dataDir = process.env.DATA_DIR?.trim() ? path.resolve(process.env.DATA_DIR) : readDataDirFromDotEnv();
	let write = false;
	let force = false;

	for (let i = 0; i < args.length; i++) {
		switch (args[i]) {
			case "--data-dir": {
				const value = args[++i];
				if (!value || value.startsWith("--")) throw new Error("--data-dir requires a path");
				dataDir = path.resolve(value);
				break;
			}
			case "--write":
				write = true;
				break;
			case "--force":
				force = true;
				break;
			case "--help":
			case "-h":
				usage();
				process.exit(0);
			default:
				throw new Error(`Unknown option: ${args[i]}`);
		}
	}
	if (force && !write) throw new Error("--force requires --write");
	return { dataDir, write, force };
}

function positiveInt(value, name) {
	if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`index.json has an invalid ${name}`);
	return value;
}

function loadIndex(directory) {
	const index = JSON.parse(readFileSync(path.join(directory, "index.json"), "utf8"));
	const intervalMs = positiveInt(index.intervalMs, "intervalMs");
	const thumbWidth = positiveInt(index.thumbWidth, "thumbWidth");
	const thumbHeight = positiveInt(index.thumbHeight, "thumbHeight");
	const columns = positiveInt(index.columns, "columns");
	const rows = positiveInt(index.rows, "rows");
	const count = positiveInt(index.count, "count");
	const sheets = positiveInt(index.sheets, "sheets");
	const tilesPerSheet = columns * rows;
	if (!Number.isSafeInteger(tilesPerSheet) || !Number.isSafeInteger(tilesPerSheet * sheets) || count > tilesPerSheet * sheets) {
		throw new Error("index.json has inconsistent count, layout, or sheet totals");
	}
	return { intervalMs, thumbWidth, thumbHeight, columns, rows, count, sheets };
}

function buildPlaylist(directory, index) {
	const tilesPerSheet = index.columns * index.rows;
	const sheetCount = Math.ceil(index.count / tilesPerSheet);
	for (let sheet = 0; sheet < sheetCount; sheet++) {
		const file = path.join(directory, `${sheet}.jpg`);
		if (!statSync(file, { throwIfNoEntry: false })?.isFile()) {
			throw new Error(`required sprite sheet is missing: ${sheet}.jpg`);
		}
	}

	const interval = index.intervalMs / 1000;
	const targetDuration = Math.ceil(interval * Math.min(index.count, tilesPerSheet));
	const lines = ["#EXTM3U", `#EXT-X-TARGETDURATION:${targetDuration}`, "#EXT-X-VERSION:7", "#EXT-X-MEDIA-SEQUENCE:1", "#EXT-X-PLAYLIST-TYPE:VOD", "#EXT-X-IMAGES-ONLY"];

	for (let sheet = 0; sheet < sheetCount; sheet++) {
		const tilesInSheet = Math.min(tilesPerSheet, index.count - sheet * tilesPerSheet);
		lines.push(`#EXTINF:${(interval * tilesInSheet).toFixed(3)},`, `#EXT-X-TILES:RESOLUTION=${index.thumbWidth}x${index.thumbHeight},LAYOUT=${index.columns}x${index.rows},DURATION=${interval.toFixed(3)}`, `${index.thumbWidth}/${sheet}.jpg`);
	}
	lines.push("#EXT-X-ENDLIST", "");
	return lines.join("\n");
}

function writePlaylist(file, contents, force) {
	const temporaryFile = `${file}.${process.pid}.${randomUUID()}.tmp`;
	try {
		writeFileSync(temporaryFile, contents, { flag: "wx", mode: 0o644 });
		if (force) {
			renameSync(temporaryFile, file);
		} else {
			try {
				linkSync(temporaryFile, file);
				rmSync(temporaryFile);
			} catch (error) {
				if (error.code === "EEXIST") throw new Error("tiles.m3u8 already exists (use --force to replace it)");
				throw error;
			}
		}
	} catch (error) {
		try {
			rmSync(temporaryFile, { force: true });
		} catch (cleanupError) {
			throw new AggregateError([error, cleanupError], `Could not clean up temporary playlist ${temporaryFile}`);
		}
		throw error;
	}
}

function convert(trickplayDir, { write, force }) {
	const entries = readdirSync(trickplayDir, { withFileTypes: true }).filter((entry) => entry.isDirectory());
	let converted = 0;
	let skipped = 0;
	let failed = 0;

	for (const entry of entries) {
		const directory = path.join(trickplayDir, entry.name);
		const indexPath = path.join(directory, "index.json");
		try {
			const index = loadIndex(directory);
			const playlistPath = path.join(directory, "tiles.m3u8");
			const existing = statSync(playlistPath, { throwIfNoEntry: false });
			if (existing && !force) {
				console.log(`SKIP ${entry.name}: tiles.m3u8 already exists (use --force to replace it)`);
				skipped++;
				continue;
			}

			const playlist = buildPlaylist(directory, index);
			if (write) writePlaylist(playlistPath, playlist, force);
			console.log(`${write ? "WROTE" : "DRY-RUN"} ${entry.name}: ${index.count} thumbnails across ${index.sheets} sheets`);
			converted++;
		} catch (error) {
			if (error.code === "ENOENT" && error.path === indexPath) {
				skipped++;
				continue;
			}
			console.error(`ERROR ${entry.name}: ${error.message}`);
			failed++;
		}
	}

	console.log(`\n${write ? "Written" : "Ready"}: ${converted}; skipped: ${skipped}; errors: ${failed}`);
	return failed === 0;
}

try {
	const options = parseArgs(process.argv.slice(2));
	const trickplayDir = path.join(options.dataDir, "cache", "trickplay");
	if (!statSync(trickplayDir, { throwIfNoEntry: false })?.isDirectory()) {
		throw new Error(`Trickplay cache directory not found: ${trickplayDir}`);
	}
	if (!options.write) console.log("Dry run: no files will be written. Pass --write to create playlists.\n");
	if (!convert(trickplayDir, options)) process.exitCode = 1;
} catch (error) {
	console.error(error.message);
	console.error("Run with --help for usage.");
	process.exitCode = 1;
}
