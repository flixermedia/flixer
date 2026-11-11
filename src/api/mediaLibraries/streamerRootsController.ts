import { Controller, Inject } from "@tsed/di";
import { BadRequest, Unauthorized } from "@tsed/exceptions";
import { HeaderParams, RawBodyParams } from "@tsed/platform-params";
import { Get, Post } from "@tsed/schema";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { appConfig } from "../../config/store/appConfig.js";
import { DataSource } from "typeorm";
import { DefaultDataSource } from "../../datasources/defaultDataSource.datasource.js";
import { Setting } from "../../entities/setting.entity.js";
import { MediaRootsService } from "./mediaRootsService.js";
import { dataPath } from "../../config/dataPath.js";
import { TRAILER_ROOT_ID } from "../media/trailerCacheService.js";
import { AD_ROOT_ID } from "../advertisements/advertisementService.js";
import { PluginStreamerService, type StreamerHook } from "../plugins/pluginStreamerService.js";

export const STREAMER_ROOTS_CONTEXT = "flixer-streamer:media-roots:v1";
export const STREAMER_TRANSCODING_CONTEXT = "flixer-streamer:transcoding:v1";
export const STREAMER_PLUGINS_CONTEXT = "flixer-streamer:plugins:v1";
export const STREAMER_HOOK_CONTEXT = "flixer-streamer:plugin-hooks:v1";
const MAX_CLOCK_SKEW_SECONDS = 5 * 60;

/**
 * Tells flixer-streamer which root media folders it may read. The request is signed with the
 * shared APP_SECRET: signature = hex(HMAC-SHA256(secret, `${context}:${timestamp}`)).
 */
@Controller("/streamer")
export class StreamerRootsController {

	constructor(
		private readonly roots: MediaRootsService,
		@Inject(DefaultDataSource) private readonly dataSource: DataSource,
		private readonly plugins: PluginStreamerService,
	) {}

	@Get("/media-roots")
	async list(
		@HeaderParams("x-streamer-timestamp") timestamp?: string,
		@HeaderParams("x-streamer-signature") signature?: string,
	) {
		this.verify(STREAMER_ROOTS_CONTEXT, timestamp, signature);
		const roots = this.roots.list().map(({ id, path }) => ({ id, path }));
		try {
			await mkdir(dataPath("advertisements"), { recursive: true });
			roots.push({ id: AD_ROOT_ID, path: dataPath("advertisements") });
		} catch (error) {
			console.error("[advertisements] Could not initialize advertisement storage for the streamer", error);
		}
		try {
			await mkdir(dataPath("cache", "trailers"), { recursive: true });
			roots.push({ id: TRAILER_ROOT_ID, path: dataPath("cache", "trailers") });
		} catch (error) {
			console.error("[trailers] Could not initialize trailer storage for the streamer", error);
		}
		return { roots };
	}

	@Get("/plugins")
	async pluginConfiguration(@HeaderParams("x-streamer-timestamp") timestamp?: string, @HeaderParams("x-streamer-signature") signature?: string) {
		this.verify(STREAMER_PLUGINS_CONTEXT, timestamp, signature);
		return { hooks: await this.plugins.available() };
	}

	@Post("/plugin-hooks")
	async pluginHook(@RawBodyParams() raw: Buffer | string | undefined, @HeaderParams("x-streamer-timestamp") timestamp?: string, @HeaderParams("x-streamer-signature") signature?: string) {
		const body = Buffer.from(raw ?? "");
		const hash = createHash("sha256").update(body).digest("hex");
		this.verify(`${STREAMER_HOOK_CONTEXT}:${hash}`, timestamp, signature);
		if (body.length > 16 * 1024) throw new BadRequest("Invalid streamer hook request.");
		let value: unknown;
		try { value = JSON.parse(body.toString("utf8")); } catch { throw new BadRequest("Invalid streamer hook request."); }
		if (!value || typeof value !== "object" || Array.isArray(value)) throw new BadRequest("Invalid streamer hook request.");
		const request = value as Record<string, unknown>;
		if (!["authorize", "manifest", "processing"].includes(String(request.hook)) || ![request.userId, request.itemId, request.sessionId].every((field) => typeof field === "string" && /^[a-zA-Z0-9._:-]{1,128}$/.test(field))) throw new BadRequest("Invalid streamer hook request.");
		if (request.height !== undefined && (typeof request.height !== "number" || ![0, 240, 360, 480, 720, 1080].includes(request.height))) throw new BadRequest("Invalid streamer hook height.");
		if (request.durationSeconds !== undefined && (typeof request.durationSeconds !== "number" || !Number.isFinite(request.durationSeconds) || request.durationSeconds < 0 || request.durationSeconds > 604800)) throw new BadRequest("Invalid streamer hook duration.");
		return this.plugins.run(request.hook as StreamerHook, { userId: request.userId as string, itemId: request.itemId as string, sessionId: request.sessionId as string, ...(request.height === undefined ? {} : { height: request.height as number }), ...(request.durationSeconds === undefined ? {} : { durationSeconds: request.durationSeconds as number }) });
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
		const secret = appConfig().get("appSecret") ?? "";
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
