import { Controller, Inject } from "@tsed/di";
import { Unauthorized } from "@tsed/exceptions";
import { HeaderParams } from "@tsed/platform-params";
import { Get } from "@tsed/schema";
import { createHmac, timingSafeEqual } from "node:crypto";
import { appConfig } from "../../config/store/appConfig.js";
import { DataSource } from "typeorm";
import { DefaultDataSource } from "../../datasources/defaultDataSource.datasource.js";
import { Setting } from "../../entities/setting.entity.js";
import { MediaRootsService } from "./mediaRootsService.js";

export const STREAMER_ROOTS_CONTEXT = "flixer-streamer:media-roots:v1";
export const STREAMER_TRANSCODING_CONTEXT = "flixer-streamer:transcoding:v1";
const MAX_CLOCK_SKEW_SECONDS = 5 * 60;

/**
 * Tells flixer-streamer which root media folders it may read. The request is signed with the
 * shared STREAM_TOKEN_SECRET: signature = hex(HMAC-SHA256(secret, `${context}:${timestamp}`)).
 */
@Controller("/streamer")
export class StreamerRootsController {

	constructor(
		private readonly roots: MediaRootsService,
		@Inject(DefaultDataSource) private readonly dataSource: DataSource,
	) {}

	@Get("/media-roots")
	list(
		@HeaderParams("x-streamer-timestamp") timestamp?: string,
		@HeaderParams("x-streamer-signature") signature?: string,
	) {
		this.verify(STREAMER_ROOTS_CONTEXT, timestamp, signature);
		return { roots: this.roots.list().map(({ id, path }) => ({ id, path })) };
	}

	/** The video encoder settings an admin chose, so the streamer can apply them without a restart. */
	@Get("/transcoding")
	async transcoding(
		@HeaderParams("x-streamer-timestamp") timestamp?: string,
		@HeaderParams("x-streamer-signature") signature?: string,
	) {
		this.verify(STREAMER_TRANSCODING_CONTEXT, timestamp, signature);
		const rows = await this.dataSource.getRepository(Setting).find();
		const value = new Map(rows.map((row) => [row.key, row.value]));
		const number = (key: string, fallback: number) => (typeof value.get(key) === "number" ? (value.get(key) as number) : fallback);
		const maxConcurrent = value.get("transcode_max_concurrent");
		const hwAccel = value.get("transcode_hw_accel");
		const preset = value.get("transcode_preset");
		return {
			hwAccel: typeof hwAccel === "string" ? hwAccel : "none",
			preset: typeof preset === "string" ? preset : "veryfast",
			crf: number("transcode_crf", 23),
			threads: number("transcode_threads", 0),
			maxBitrateKbps: number("transcode_max_bitrate_kbps", 0),
			maxConcurrent: typeof maxConcurrent === "number" ? maxConcurrent : null,
		};
	}

	private verify(context: string, timestamp?: string, signature?: string): void {
		const secret = appConfig().get("streamTokenSecret") ?? "";
		const issuedAt = Number(timestamp);
		if (Buffer.byteLength(secret) < 32 || !signature || !Number.isInteger(issuedAt)) {
			throw new Unauthorized("Invalid streamer signature.");
		}
		if (Math.abs(Date.now() / 1000 - issuedAt) > MAX_CLOCK_SKEW_SECONDS) {
			throw new Unauthorized("Streamer signature has expired.");
		}

		const expected = createHmac("sha256", secret).update(`${context}:${issuedAt}`).digest();
		const provided = Buffer.from(signature, "hex");
		if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
			throw new Unauthorized("Invalid streamer signature.");
		}
	}
}
