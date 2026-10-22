import sharp from "sharp";

/** Widths a client may ask for. Anything else is rounded up to the next one, which keeps the cache small. */
export const IMAGE_WIDTHS = [64, 128, 256, 384, 512, 768, 1024, 1536, 2048] as const;
const MAX_CACHE_BYTES = 64 * 1024 * 1024;
const MAX_INPUT_PIXELS = 100_000_000;

/** Rounds a requested width up to an allowed one; undefined (or invalid) means the original size. */
export function normalizeWidth(width: unknown): number | undefined {
	if (typeof width !== "number" || !Number.isFinite(width) || width <= 0) {
		return undefined;
	}
	return IMAGE_WIDTHS.find((allowed) => allowed >= width) ?? IMAGE_WIDTHS[IMAGE_WIDTHS.length - 1];
}

interface CachedImage {
	data: Buffer;
	mime: string;
}

const cache = new Map<string, CachedImage>();
let cachedBytes = 0;

function remember(key: string, value: CachedImage): void {
	cache.set(key, value);
	cachedBytes += value.data.length;
	// Map keeps insertion order, so the first key is the least recently used.
	for (const oldest of cache.keys()) {
		if (cachedBytes <= MAX_CACHE_BYTES || cache.size <= 1) {
			break;
		}
		cachedBytes -= cache.get(oldest)?.data.length ?? 0;
		cache.delete(oldest);
	}
}

/**
 * Scales an image down to the given width as WebP. Images already narrower are not enlarged, and anything sharp
 * cannot read (or vector images) is returned untouched. `cacheKey` must change whenever the source image does.
 */
export async function resizeImage(source: () => Promise<CachedImage>, cacheKey: string, width: number | undefined): Promise<CachedImage> {
	if (width === undefined) {
		return source();
	}
	const key = `${cacheKey}:${width}`;
	const hit = cache.get(key);
	if (hit) {
		cache.delete(key);
		cache.set(key, hit);
		return hit;
	}
	const original = await source();
	if (original.mime.includes("svg")) {
		return original;
	}
	try {
		const data = await sharp(original.data, { failOn: "none", limitInputPixels: MAX_INPUT_PIXELS, animated: false })
			.rotate()
			.resize({ width, withoutEnlargement: true })
			.webp({ quality: 80 })
			.toBuffer();
		const resized = data.length < original.data.length ? { data, mime: "image/webp" } : original;
		remember(key, resized);
		return resized;
	} catch {
		return original;
	}
}
