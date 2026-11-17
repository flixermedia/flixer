import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { deleteUpload, readUpload, saveUpload, uploadFilename } from "./mediaImageStorage.js";

describe("media image cache storage", () => {
	const originalDataPath = process.env.DATA_PATH;
	let dataPath: string | undefined;

	afterEach(async () => {
		if (originalDataPath === undefined) {
			delete process.env.DATA_PATH;
		} else {
			process.env.DATA_PATH = originalDataPath;
		}
		if (dataPath) {
			await rm(dataPath, { recursive: true, force: true });
			dataPath = undefined;
		}
	});

	it("stores manual artwork below the stable media cache key", async () => {
		dataPath = await mkdtemp(join(tmpdir(), "flixer-data-"));
		process.env.DATA_PATH = dataPath;
		const rootId = "library-root";
		const relativePath = "Films/Example/movie.mkv";
		const itemId = "01234567-89ab-cdef-0123-456789abcdef";
		const key = createHash("sha256").update(`${rootId}\n${relativePath}`).digest("hex").slice(0, 32);
		const filename = await saveUpload(rootId, relativePath, itemId, Buffer.from("image"), {
			ext: "jpg",
			mime: "image/jpeg",
		});

		expect(filename).toMatch(new RegExp(`^${key}/manual/`));
		expect(uploadFilename(`upload:${filename}`)).toBe(filename);
		expect(await readUpload(filename)).toEqual(Buffer.from("image"));
		await deleteUpload(filename);
		expect(await readUpload(filename)).toBeNull();
	});
});
