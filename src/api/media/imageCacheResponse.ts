import { createHash } from "node:crypto";
import type { PlatformContext } from "@tsed/platform-http";

/** Allows the native app to revalidate its own private artwork cache after authorization. */
export function imageCacheResponse(
	ctx: PlatformContext,
	image: { data: Buffer; mime: string },
	defaultCacheControl: string,
	appCache: string | undefined,
	validator: string | undefined,
): Buffer | undefined {
	ctx.response.setHeader("Content-Type", image.mime);
	ctx.response.setHeader("Cache-Control", defaultCacheControl);
	ctx.response.setHeader("X-Content-Type-Options", "nosniff");
	ctx.response.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
	if (appCache !== "1") return image.data;

	const etag = `"${createHash("sha256").update(image.mime).update("\0").update(image.data).digest("base64url")}"`;
	ctx.response.setHeader("Cache-Control", "private, no-cache");
	ctx.response.setHeader("Vary", "Origin, Authorization, X-Flixer-App-Image-Cache");
	ctx.response.setHeader("ETag", etag);
	ctx.response.setHeader("Access-Control-Expose-Headers", "ETag");
	if (validator === etag) {
		ctx.response.status(304);
		return undefined;
	}
	return image.data;
}
