import { createHash } from "node:crypto";
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

const DISCOGS_HOSTS = new Set(["i.discogs.com", "img.discogs.com", "st.discogs.com"]);

/** Parses a Discogs image URL, accepting only https on the known Discogs image hosts. */
function parseDiscogsUrl(value: string): URL | null {
	try {
		const url = new URL(value);
		return url.protocol === "https:" && DISCOGS_HOSTS.has(url.hostname) && !url.username && !url.password && url.port === "" ? url : null;
	} catch {
		return null;
	}
}

/** Path the cached copy of a Discogs image is served from, or null when the URL is not a Discogs image. */
export function discogsImagePath(url: string | null): string | null {
	const parsed = url ? parseDiscogsUrl(url) : null;
	return parsed ? `/requests/images/discogs?u=${encodeURIComponent(parsed.href)}` : null;
}

/** Rewrites a stored TMDB or Discogs image URL to its cached route; anything else is returned unchanged. */
export function cachedImageUrl(url: string | null): string | null {
	const match = url ? URL_PATTERN.exec(url) : null;
	return match ? tmdbImagePath(match[1], match[2]) : (discogsImagePath(url) ?? url);
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

/** Downloads Discogs images once and serves them from DATA_DIR/cache/discogs afterwards. */
@Injectable()
export class DiscogsImageCache {
	private readonly pending = new Map<string, Promise<Buffer>>();

	async get(source: string): Promise<{ data: Buffer; mime: string }> {
		const url = parseDiscogsUrl(source);
		if (!url) {
			throw new NotFound("Not found.");
		}
		const key = createHash("sha256").update(url.href).digest("hex");
		let request = this.pending.get(key);
		if (!request) {
			request = this.load(url, key).finally(() => this.pending.delete(key));
			this.pending.set(key, request);
		}
		const data = await request;
		const type = detectAvatarType(data);
		if (!type) {
			throw new NotFound("Not found.");
		}
		return { data, mime: type.mime };
	}

	private async load(url: URL, key: string): Promise<Buffer> {
		const directory = dataPath("cache", "discogs");
		const target = join(directory, key);
		try {
			return await readFile(target);
		} catch {
			// Not cached yet.
		}
		let response: Response;
		try {
			response = await fetch(url, {
				redirect: "manual",
				headers: { "user-agent": "Flixer/1.0 (+https://flixer.dev)" },
				signal: AbortSignal.timeout(TIMEOUT_MS),
			});
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
