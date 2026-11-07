import { Inject, Injectable, logger } from "@tsed/di";
import { BadRequest, NotFound, ServiceUnavailable } from "@tsed/exceptions";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmod, mkdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { DataSource } from "typeorm";
import { dataPath } from "../../config/dataPath.js";
import { DefaultDataSource } from "../../datasources/defaultDataSource.datasource.js";
import { Advertisement } from "../../entities/advertisement.entity.js";
import { AdvertisementSettings } from "../../entities/advertisementSettings.entity.js";
import { parseScopes } from "../payments/paymentTypes.js";
import { ChunkUploadStore } from "../uploads/chunkUploadStore.js";

export const AD_ROOT_ID = "flixer-advertisements";
export const AD_MAX_BYTES = 100 * 1024 * 1024;
export const AD_CHUNK_BYTES = 5 * 1024 * 1024;
const execFileAsync = promisify(execFile);

function object(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new BadRequest("Invalid advertisement data.");
	return value as Record<string, unknown>;
}

function integer(value: unknown, minimum: number, maximum: number): number {
	if (typeof value !== "number" || !Number.isInteger(value) || value < minimum || value > maximum) throw new BadRequest("Invalid advertisement setting.");
	return value;
}

function url(value: unknown): string {
	if (typeof value !== "string" || value.length > 2048) throw new BadRequest("Enter a valid advertising URL.");
	let parsed: URL;
	try { parsed = new URL(value); } catch { throw new BadRequest("Enter a valid advertising URL."); }
	if (!["https:", "http:"].includes(parsed.protocol) || parsed.username || parsed.password) throw new BadRequest("Enter an HTTP or HTTPS advertising URL.");
	return parsed.href;
}

@Injectable()
export class AdvertisementService {
	private readonly uploads = new ChunkUploadStore(dataPath("advertisements", ".uploads"), AD_MAX_BYTES, AD_CHUNK_BYTES, 24 * 60 * 60 * 1000);
	private readonly completions = new Map<string, Promise<Advertisement>>();

	constructor(@Inject(DefaultDataSource) private readonly dataSource: DataSource) {}

	settings() {
		return this.dataSource.getRepository(AdvertisementSettings).findOneByOrFail({ id: 1 });
	}

	async saveSettings(raw: unknown) {
		const body = object(raw);
		if (typeof body.enabled !== "boolean") throw new BadRequest("Invalid advertisement setting.");
		const settings = await this.settings();
		settings.enabled = body.enabled;
		settings.minimumIntervalSeconds = integer(body.minimumIntervalSeconds, 0, 86400);
		settings.maxPerPlayback = integer(body.maxPerPlayback, 0, 100);
		return this.dataSource.getRepository(AdvertisementSettings).save(settings);
	}

	list() {
		return this.dataSource.getRepository(Advertisement).find({ order: { createdAt: "DESC" } });
	}

	createUpload(ownerId: string, size: number) {
		return this.uploads.create(ownerId, size);
	}

	putChunk(id: string, ownerId: string, index: number, buffer: Buffer) {
		return this.uploads.put(id, ownerId, index, buffer);
	}

	cancelUpload(id: string, ownerId: string) {
		return this.uploads.remove(id, ownerId);
	}

	completeUpload(id: string, ownerId: string, raw: unknown): Promise<Advertisement> {
		const key = `${ownerId}:${id}`;
		const existing = this.completions.get(key);
		if (existing) return existing;
		const completion = this.finishUpload(id, ownerId, raw).finally(() => this.completions.delete(key));
		this.completions.set(key, completion);
		return completion;
	}

	private async finishUpload(id: string, ownerId: string, raw: unknown): Promise<Advertisement> {
		const body = object(raw);
		const name = typeof body.name === "string" ? body.name.trim() : "";
		if (!name || name.length > 200) throw new BadRequest("Enter an advertisement name.");
		const targetUrl = url(body.targetUrl);
		const file = await this.uploads.assemble(id, ownerId);
		let result: { stdout: string };
		try {
			result = await execFileAsync("ffprobe", ["-v", "error", "-protocol_whitelist", "file,pipe", "-show_entries", "format=format_name,duration:stream=codec_type,codec_name", "-of", "json", file], { timeout: 30000, maxBuffer: 1024 * 1024 });
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new ServiceUnavailable("Video inspection requires ffprobe on the API server.");
			logger().warn("Advertisement video inspection failed.", error);
			throw new BadRequest("The uploaded file could not be inspected. Upload an MP4 video.");
		}
		const probe = JSON.parse(result.stdout) as { format?: { format_name?: string; duration?: string }; streams?: { codec_type?: string; codec_name?: string }[] };
		const duration = Number(probe.format?.duration);
		if (!probe.format?.format_name?.split(",").includes("mp4") || !Number.isFinite(duration) || duration <= 0 ||
			!probe.streams?.some((stream) => stream.codec_type === "video" && stream.codec_name === "h264") ||
			probe.streams.some((stream) => stream.codec_type === "video" && stream.codec_name !== "h264") ||
			probe.streams.some((stream) => stream.codec_type === "audio" && stream.codec_name !== "aac")) {
			throw new BadRequest("Upload an MP4 with H.264 video and AAC audio.");
		}
		const directory = dataPath("advertisements");
		await mkdir(directory, { recursive: true });
		const adId = randomUUID();
		const filename = `${adId}.mp4`;
		await chmod(file, 0o644);
		await rename(file, join(directory, filename));
		let saved: Advertisement;
		try {
			const repository = this.dataSource.getRepository(Advertisement);
			saved = await repository.save(repository.create({
				id: adId, filename, name, targetUrl, durationSeconds: duration,
				enabled: false, scopes: [{ type: "all", ref: null }], preroll: true, midrollSeconds: [], skipAfterSeconds: null,
			}));
		} catch (error) {
			await rename(join(directory, filename), file);
			throw error;
		}
		try {
			await this.uploads.remove(id, ownerId);
		} catch (error) {
			logger().warn("Could not remove a completed advertisement upload session.", error);
		}
		return saved;
	}

	async update(id: string, raw: unknown) {
		const repository = this.dataSource.getRepository(Advertisement);
		const ad = await repository.findOneBy({ id });
		if (!ad) throw new NotFound("Advertisement not found.");
		const body = object(raw);
		if (typeof body.name !== "string" || !body.name.trim() || body.name.length > 200) throw new BadRequest("Enter an advertisement name.");
		if (typeof body.enabled !== "boolean" || typeof body.preroll !== "boolean") throw new BadRequest("Invalid advertisement setting.");
		if (!Array.isArray(body.midrollSeconds) || body.midrollSeconds.length > 100) throw new BadRequest("Invalid ad break positions.");
		const positions = body.midrollSeconds.map((value) => integer(value, 1, 604800));
		ad.name = body.name.trim();
		ad.targetUrl = url(body.targetUrl);
		ad.enabled = body.enabled;
		ad.preroll = body.preroll;
		ad.scopes = parseScopes(body.scopes, { allowEmpty: false });
		ad.midrollSeconds = [...new Set(positions)].sort((a, b) => a - b);
		ad.skipAfterSeconds = body.skipAfterSeconds === null ? null : integer(body.skipAfterSeconds, 0, Math.floor(ad.durationSeconds));
		return repository.save(ad);
	}

	async remove(id: string) {
		const repository = this.dataSource.getRepository(Advertisement);
		const ad = await repository.findOneBy({ id });
		if (!ad) throw new NotFound("Advertisement not found.");
		if (ad.filename !== `${ad.id}.mp4`) throw new Error("Invalid advertisement filename.");
		await repository.delete({ id });
		await rm(join(dataPath("advertisements"), ad.filename), { force: true });
	}
}
