import { encode } from "blurhash";
import sharp from "sharp";

const MAX_INPUT_PIXELS = 100_000_000;
const BLURHASH_SIZE = 32;
const COMPONENT_X = 4;
const COMPONENT_Y = 3;

/**
 * Encodes a raster image buffer into a compact BlurHash string for progressive placeholders.
 * Returns null for SVGs or unreadable/corrupt image buffers so callers never fail on artwork metadata.
 */
export async function computeBlurhash(data: Buffer, mime?: string): Promise<string | null> {

	if (mime?.includes("svg") || data.length === 0) {
		return null;
	}
	try {
		const { data: pixels, info } = await sharp(data, { failOn: "none", limitInputPixels: MAX_INPUT_PIXELS, animated: false }).rotate().resize(BLURHASH_SIZE, BLURHASH_SIZE, { fit: "inside" }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
		if (info.width <= 0 || info.height <= 0 || pixels.length < info.width * info.height * 4) {
			return null;
		}
		return encode(new Uint8ClampedArray(pixels.buffer, pixels.byteOffset, pixels.byteLength), info.width, info.height, COMPONENT_X, COMPONENT_Y);
	} catch {
		return null;
	}

}
