import { randomBytes } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

export const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

const AVATAR_FILENAME_PATTERN = /^[0-9a-f-]{36}-[0-9a-f]{16}\.(png|jpg|webp|gif)$/;

export interface AvatarType {
	ext: "png" | "jpg" | "webp" | "gif";
	mime: string;
}

/** Folder profile pictures are stored in, configured with AVATAR_DIR. */
export function getAvatarDirectory(): string {
	return resolve(process.env.AVATAR_DIR?.trim() || "./data/avatars");
}

/** Identifies the image type from its magic bytes instead of trusting the client's MIME type. */
export function detectAvatarType(buffer: Buffer): AvatarType | null {
	if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
		return { ext: "png", mime: "image/png" };
	}
	if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
		return { ext: "jpg", mime: "image/jpeg" };
	}
	if (buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") {
		return { ext: "webp", mime: "image/webp" };
	}
	if (buffer.length >= 6 && ["GIF87a", "GIF89a"].includes(buffer.toString("ascii", 0, 6))) {
		return { ext: "gif", mime: "image/gif" };
	}
	return null;
}

export function mimeForAvatarFile(filename: string): string | null {
	const ext = filename.slice(filename.lastIndexOf(".") + 1);
	return { png: "image/png", jpg: "image/jpeg", webp: "image/webp", gif: "image/gif" }[ext] ?? null;
}

export function isAvatarFilename(filename: string): boolean {
	return AVATAR_FILENAME_PATTERN.test(filename);
}

export async function saveAvatarFile(userId: string, buffer: Buffer, type: AvatarType): Promise<string> {
	const directory = getAvatarDirectory();
	await mkdir(directory, { recursive: true });
	const filename = `${userId}-${randomBytes(8).toString("hex")}.${type.ext}`;
	await writeFile(join(directory, filename), buffer, { flag: "wx" });
	return filename;
}

export async function readAvatarFile(filename: string): Promise<Buffer | null> {
	if (!isAvatarFilename(filename)) {
		return null;
	}
	try {
		return await readFile(join(getAvatarDirectory(), filename));
	} catch {
		return null;
	}
}

export async function deleteAvatarFile(filename: string | null | undefined): Promise<void> {
	if (!filename || !isAvatarFilename(filename)) {
		return;
	}
	try {
		await unlink(join(getAvatarDirectory(), filename));
	} catch {
		// Already gone; nothing to clean up.
	}
}
