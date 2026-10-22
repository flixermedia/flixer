import { randomBytes } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { detectAvatarType, type AvatarType } from "../auth/avatarStorage.js";

export const MAX_MEDIA_IMAGE_BYTES = 15 * 1024 * 1024;
export const MANUAL_PROVIDER = "manual";
export const UPLOAD_PREFIX = "upload:";

const FILENAME_PATTERN = /^[0-9a-f-]{36}-[0-9a-f]{16}\.(png|jpg|webp|gif)$/;
const MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", webp: "image/webp", gif: "image/gif" };

/** Folder artwork uploaded by admins is stored in, configured with MEDIA_IMAGE_DIR. */
export function getMediaImageDirectory(): string {
	return resolve(process.env.MEDIA_IMAGE_DIR?.trim() || "./data/media-images");
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

export async function saveUpload(itemId: string, buffer: Buffer, type: AvatarType): Promise<string> {
	const directory = getMediaImageDirectory();
	await mkdir(directory, { recursive: true });
	const filename = `${itemId}-${randomBytes(8).toString("hex")}.${type.ext}`;
	await writeFile(join(directory, filename), buffer, { flag: "wx" });
	return filename;
}

export async function readUpload(filename: string): Promise<Buffer | null> {
	if (!FILENAME_PATTERN.test(filename)) {
		return null;
	}
	return readFile(join(getMediaImageDirectory(), filename)).catch(() => null);
}

export async function deleteUpload(filename: string | null): Promise<void> {
	if (filename && FILENAME_PATTERN.test(filename)) {
		await unlink(join(getMediaImageDirectory(), filename)).catch(() => undefined);
	}
}
