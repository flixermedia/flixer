import { Exception } from "@tsed/exceptions";

/** Hosts person photos are fetched from. Metadata is provider-supplied, so nothing else is ever requested. */
const ALLOWED_HOSTS = new Set(["image.tmdb.org", "artworks.thetvdb.com", "thetvdb.com", "www.thetvdb.com", "i.discogs.com"]);
const MAX_BYTES = 5 * 1024 * 1024;
const TIMEOUT_MS = 10_000;

export function allowedPersonImage(value: unknown): string | null {
	if (typeof value !== "string" || value.length > 500) {
		return null;
	}
	try {
		const url = new URL(value.trim());
		return url.protocol === "https:" && !url.username && !url.password && ALLOWED_HOSTS.has(url.hostname) ? url.toString() : null;
	} catch {
		return null;
	}
}

export async function fetchPersonImage(url: string): Promise<{ data: Buffer; mime: string }> {
	const safe = allowedPersonImage(url);
	if (!safe) {
		throw new Exception(404, "Image not found.");
	}
	let response: Response;
	try {
		response = await fetch(safe, { redirect: "error", signal: AbortSignal.timeout(TIMEOUT_MS), headers: { accept: "image/*" } });
	} catch {
		throw new Exception(502, "The image could not be loaded.");
	}
	const mime = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() ?? "";
	if (!response.ok || !/^image\/(jpeg|png|webp)$/.test(mime)) {
		throw new Exception(response.status === 404 ? 404 : 502, "The image could not be loaded.");
	}
	const data = Buffer.from(await response.arrayBuffer());
	if (data.length === 0 || data.length > MAX_BYTES) {
		throw new Exception(502, "The image could not be loaded.");
	}
	return { data, mime };
}
