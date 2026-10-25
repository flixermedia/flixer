import { createHash, randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { detectAvatarType, type AvatarType } from "../auth/avatarStorage.js";
import { dataPath } from "../../config/dataPath.js";

export const MAX_MEDIA_IMAGE_BYTES = 15 * 1024 * 1024;
export const MANUAL_PROVIDER = "manual";
export const UPLOAD_PREFIX = "upload:";

const FILENAME_PATTERN = /^[0-9a-f]{32}\/manual\/[0-9a-f-]{36}-[0-9a-f]{16}\.(png|jpg|webp|gif)$/;
const MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", webp: "image/webp", gif: "image/gif" };

function mediaKey(rootId: string, relativePath: string): string {

	if (!rootId || !relativePath) {
		throw new Error("A media root ID and relative path are required for image storage.");
	}
	return createHash("sha256").update(`${rootId}\n${relativePath}`).digest("hex").slice(0, 32);

}

function getMediaImageDirectory(key: string): string {
	return dataPath("cache", "images", key, "manual");
}

async function ensureSharedDirectory(directory: string): Promise<void> {

	await mkdir(directory, { recursive: true });
	const existing = await stat(directory);
	if ((existing.mode & 0o020) === 0 || (existing.mode & 0o2000) === 0) {
		await chmod(directory, 0o2775);
	}

}

export function detectImageType(buffer: Buffer): AvatarType | null {
	return detectAvatarType(buffer);
}

export function mimeForUpload(filename: string): string | null {
	return MIME[filename.slice(filename.lastIndexOf(".") + 1)] ?? null;
}

/** The file name behind an uploaded image's stored path, or null when the path is not an upload. */
export function uploadFilename(path: unknown): string | null {

	if (typeof path !== "string" || !path.startsWith(UPLOAD_PREFIX)) {
		return null;
	}
	const filename = path.slice(UPLOAD_PREFIX.length);
	return FILENAME_PATTERN.test(filename) ? filename : null;

}

export async function saveUpload(
	rootId: string,
	relativePath: string,
	itemId: string,
	buffer: Buffer,
	type: AvatarType,
): Promise<string> {

	const key = mediaKey(rootId, relativePath);
	const mediaDirectory = dirname(getMediaImageDirectory(key));
	await ensureSharedDirectory(mediaDirectory);
	const directory = getMediaImageDirectory(key);
	await ensureSharedDirectory(directory);
	const filename = `${itemId}-${randomBytes(8).toString("hex")}.${type.ext}`;
	await writeFile(join(directory, filename), buffer, { flag: "wx" });
	return `${key}/manual/${filename}`;

}

export async function readUpload(filename: string): Promise<Buffer | null> {

	if (!FILENAME_PATTERN.test(filename)) {
		return null;
	}
	const [key, , name] = filename.split("/");
	return readFile(join(getMediaImageDirectory(key), name)).catch(() => null);

}

export async function deleteUpload(filename: string | null): Promise<void> {

	if (filename && FILENAME_PATTERN.test(filename)) {
		const [key, , name] = filename.split("/");
		await unlink(join(getMediaImageDirectory(key), name)).catch(() => undefined);
	}

}
