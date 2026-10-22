import { Controller } from "@tsed/di";
import { Unauthorized } from "@tsed/exceptions";
import { HeaderParams } from "@tsed/platform-params";
import { Get } from "@tsed/schema";
import { createHmac, timingSafeEqual } from "node:crypto";
import { MediaRootsService } from "./mediaRootsService.js";

export const STREAMER_ROOTS_CONTEXT = "flixer-streamer:media-roots:v1";
const MAX_CLOCK_SKEW_SECONDS = 5 * 60;

/**
 * Tells flixer-streamer which root media folders it may read. The request is signed with the
 * shared STREAM_TOKEN_SECRET: signature = hex(HMAC-SHA256(secret, `${context}:${timestamp}`)).
 */
@Controller("/streamer")
export class StreamerRootsController {

	constructor(private readonly roots: MediaRootsService) {}

	@Get("/media-roots")
	list(
		@HeaderParams("x-streamer-timestamp") timestamp?: string,
		@HeaderParams("x-streamer-signature") signature?: string,
	) {
		this.verify(timestamp, signature);
		return { roots: this.roots.list().map(({ id, path }) => ({ id, path })) };
	}

	private verify(timestamp?: string, signature?: string): void {
		const secret = process.env.STREAM_TOKEN_SECRET?.trim() ?? "";
		const issuedAt = Number(timestamp);
		if (Buffer.byteLength(secret) < 32 || !signature || !Number.isInteger(issuedAt)) {
			throw new Unauthorized("Invalid streamer signature.");
		}
		if (Math.abs(Date.now() / 1000 - issuedAt) > MAX_CLOCK_SKEW_SECONDS) {
			throw new Unauthorized("Streamer signature has expired.");
		}

		const expected = createHmac("sha256", secret).update(`${STREAMER_ROOTS_CONTEXT}:${issuedAt}`).digest();
		const provided = Buffer.from(signature, "hex");
		if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
			throw new Unauthorized("Invalid streamer signature.");
		}
	}
}
