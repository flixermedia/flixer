import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { computeBlurhash } from "./blurhash.js";

describe("computeBlurhash", () => {
	it("encodes a valid raster image into a blurhash string", async () => {
		const png = await sharp({
			create: { width: 64, height: 96, channels: 4, background: { r: 24, g: 120, b: 200, alpha: 1 } },
		})
			.png()
			.toBuffer();

		const hash = await computeBlurhash(png, "image/png");
		expect(hash).toBeTypeOf("string");
		expect(hash!.length).toBeGreaterThanOrEqual(6);
	});

	it("returns null for SVGs, empty buffers, and corrupt data", async () => {
		expect(await computeBlurhash(Buffer.from("<svg></svg>"), "image/svg+xml")).toBeNull();
		expect(await computeBlurhash(Buffer.alloc(0), "image/png")).toBeNull();
		expect(await computeBlurhash(Buffer.from("not-an-image"), "image/jpeg")).toBeNull();
	});
});
