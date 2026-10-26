import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Injectable } from "@tsed/di";
import { NotFound } from "@tsed/exceptions";
import { dataPath } from "../../config/dataPath.js";
import { detectAvatarType } from "../auth/avatarStorage.js";

const TMDB_IMAGE_HOST = "https://image.tmdb.org/t/p";
const TIMEOUT_MS = 10_000;
const MAX_BYTES = 10 * 1024 * 1024;

export const TMDB_IMAGE_SIZES = ["w92", "w154", "w185", "w300", "w342", "w500", "w780", "w1280", "original"] as const;
const FILE_PATTERN = /^[A-Za-z0-9_-]{5,64}\.(jpg|png|webp)$/;
const URL_PATTERN = /^https:\/\/image\.tmdb\.org\/t\/p\/([a-z0-9]+)\/([A-Za-z0-9_-]{5,64}\.(?:jpg|png|webp))$/;

/** Path (relative to the API root) the cached copy of a TMDB image is served from. */
export function tmdbImagePath(size: string, file: string): string {
	return `/requests/images/tmdb/${size}/${file}`;
}

/** Rewrites a stored TMDB image URL to the cached route; anything else is returned unchanged. */
export function cachedImageUrl(url: string | null): string | null {
	const match = url ? URL_PATTERN.exec(url) : null;
	return match ? tmdbImagePath(match[1], match[2]) : url;
}

/** Downloads TMDB images once and serves them from DATA_DIR/cache/tmdb afterwards. */
@Injectable()
export class TmdbImageCache {
	private readonly pending = new Map<string, Promise<Buffer>>();

	async get(size: string, file: string): Promise<{ data: Buffer; mime: string }> {
		if (!(TMDB_IMAGE_SIZES as readonly string[]).includes(size) || !FILE_PATTERN.test(file)) {
			throw new NotFound("Not found.");
		}
		const key = `${size}/${file}`;
		let request = this.pending.get(key);
		if (!request) {
			request = this.load(size, file).finally(() => this.pending.delete(key));
			this.pending.set(key, request);
		}
		const data = await request;
		const type = detectAvatarType(data);
		if (!type) {
			throw new NotFound("Not found.");
		}
		return { data, mime: type.mime };
	}

	private async load(size: string, file: string): Promise<Buffer> {
		const directory = dataPath("cache", "tmdb", size);
		const target = join(directory, file);
		try {
			return await readFile(target);
		} catch {
			// Not cached yet.
		}
		let response: Response;
		try {
			response = await fetch(`${TMDB_IMAGE_HOST}/${size}/${file}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
		} catch {
			throw new NotFound("Image unavailable.");
		}
		if (!response.ok) {
			throw new NotFound("Image unavailable.");
		}
		const data = Buffer.from(await response.arrayBuffer());
		if (data.length === 0 || data.length > MAX_BYTES || !detectAvatarType(data)) {
			throw new NotFound("Image unavailable.");
		}
		await mkdir(directory, { recursive: true });
		const temporary = `${target}.${process.pid}.tmp`;
		await writeFile(temporary, data);
		await rename(temporary, target);
		return data;
	}
}
