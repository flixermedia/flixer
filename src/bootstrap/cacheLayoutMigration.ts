import { createHash } from "node:crypto";
import { mkdir, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { DataSource } from "typeorm";
import { dataPath } from "../config/dataPath.js";

const MARKER_FILE = ".layout-v2";

async function exists(path: string): Promise<boolean> {
	try {
		await stat(path);
		return true;
	} catch {
		return false;
	}
}

/** Moves `src` to `dest`, merging directory contents if `dest` already exists. */
async function moveMerge(src: string, dest: string): Promise<void> {
	if (!(await exists(src))) return;
	await mkdir(dirname(dest), { recursive: true });
	if (!(await exists(dest))) {
		await rename(src, dest);
		return;
	}
	const srcInfo = await stat(src);
	if (!srcInfo.isDirectory()) {
		await rm(src, { force: true });
		return;
	}
	for (const entry of await readdir(src, { withFileTypes: true })) {
		const from = join(src, entry.name);
		const to = join(dest, entry.name);
		if (entry.isDirectory()) {
			await moveMerge(from, to);
		} else if (!(await exists(to))) {
			await rename(from, to);
		} else {
			await rm(from, { force: true });
		}
	}
	await rm(src, { recursive: true, force: true });
}

async function migrateKeyedSubdir(srcRoot: string, libraryRoot: string, nestedName?: string): Promise<void> {
	if (!(await exists(srcRoot))) return;
	for (const entry of await readdir(srcRoot, { withFileTypes: true })) {
		if (!entry.isDirectory()) continue;
		const src = join(srcRoot, entry.name);
		const dest = nestedName ? join(libraryRoot, entry.name, nestedName) : join(libraryRoot, entry.name);
		await moveMerge(src, dest);
	}
	await rm(srcRoot, { recursive: true, force: true });
}

async function migrateTrailers(srcRoot: string, libraryRoot: string, dataSource?: DataSource): Promise<void> {
	if (!(await exists(srcRoot))) return;
	const entries = await readdir(srcRoot, { withFileTypes: true });
	const keyByItemId = new Map<string, string>();
	if (dataSource && entries.length > 0) {
		const ids = entries
			.map((e) => /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-[1-9]\d*\.mp4$/i.exec(e.name)?.[1]?.toLowerCase())
			.filter((id): id is string => Boolean(id));
		if (ids.length > 0) {
			const rows: Array<{ id: string; root_id: string | null; relative_path: string | null }> = await dataSource.query(
				`SELECT id, root_id, relative_path FROM media_items WHERE id = ANY($1::uuid[])`,
				[[...new Set(ids)]],
			);
			for (const row of rows) {
				if (row.root_id && row.relative_path) {
					const key = createHash("sha256").update(`${row.root_id}\n${row.relative_path}`).digest("hex").slice(0, 32);
					keyByItemId.set(row.id.toLowerCase(), key);
				}
			}
		}
	}
	for (const entry of entries) {
		if (!entry.isFile()) continue;
		const match = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-([1-9]\d*\.mp4)$/i.exec(entry.name);
		const key = match ? keyByItemId.get(match[1].toLowerCase()) : undefined;
		const dest = key && match ? join(libraryRoot, key, `trailer-${match[2]}`) : join(libraryRoot, "trailers", entry.name);
		await moveMerge(join(srcRoot, entry.name), dest);
	}
	await rm(srcRoot, { recursive: true, force: true });
}

/** Migrates legacy DATA_DIR/cache/* directories into cache/library/* and cache/providers/* and updates stored image paths. */
export async function migrateCacheLayout(dataSource?: DataSource): Promise<void> {
	const cacheRoot = dataPath("cache");
	if (!(await exists(cacheRoot))) return;
	const marker = join(cacheRoot, MARKER_FILE);
	if (await exists(marker)) return;

	const libraryRoot = join(cacheRoot, "library");
	const providersRoot = join(cacheRoot, "providers");

	await moveMerge(join(cacheRoot, "tmdb"), join(providersRoot, "tmdb"));
	await moveMerge(join(cacheRoot, "discogs"), join(providersRoot, "discogs"));
	await moveMerge(join(cacheRoot, "people"), join(providersRoot, "people"));
	await moveMerge(join(cacheRoot, "lyrics"), join(libraryRoot, "lyrics"));

	await migrateKeyedSubdir(join(cacheRoot, "images"), libraryRoot);
	await migrateKeyedSubdir(join(cacheRoot, "theme"), libraryRoot);
	await migrateKeyedSubdir(join(cacheRoot, "trickplay"), libraryRoot, "trickplay");
	await migrateKeyedSubdir(join(cacheRoot, "subtitles"), libraryRoot, "subtitles");
	await migrateTrailers(join(cacheRoot, "trailers"), libraryRoot, dataSource);

	if (dataSource) {
		await dataSource.query(`
			UPDATE media_items
			SET images = (
				SELECT jsonb_agg(
					CASE
						WHEN elem->>'path' LIKE '%/cache/images/%'
						THEN jsonb_set(elem, '{path}', to_jsonb(replace(elem->>'path', '/cache/images/', '/cache/library/')))
						ELSE elem
					END
				)
				FROM jsonb_array_elements(images) AS elem
			)
			WHERE images::text LIKE '%/cache/images/%'
		`);
	}

	await writeFile(marker, "v2\n");
}
