import { Inject, Injectable } from "@tsed/di";
import { BadRequest, NotFound } from "@tsed/exceptions";
import { createCipheriv, createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { readdir } from "node:fs/promises";
import { extname, join, relative, sep } from "node:path";
import { DataSource } from "typeorm";
import { DefaultDataSource } from "../../datasources/defaultDataSource.datasource.js";
import { MediaItem, type MediaItemType } from "../../entities/mediaItem.entity.js";
import { AuthService } from "../auth/authService.js";
import { MediaLibrariesService } from "../mediaLibraries/mediaLibrariesService.js";
import { appConfig } from "../../config/store/appConfig.js";
import { MediaRootsService } from "../mediaLibraries/mediaRootsService.js";

const TOKEN_LIFETIME_SECONDS = 60 * 60;
const LOCATOR_AAD = "flixer-streamer:media-locator:v1";
const SAMPLE_EXTENSIONS = new Set([".mp4", ".webm", ".mkv"]);
const AUDIO_EXTENSIONS = new Set([".mp3", ".flac", ".m4a", ".aac", ".ogg", ".opus", ".wav", ".aiff", ".aif"]);
const PLAYABLE_TYPES: MediaItemType[] = ["movie", "episode", "video", "track"];

export interface SampleVideo {
	id: string;
	title: string;
	container: string;
	/** False when the streamer must remux or transcode the file for browsers. */
	directPlay: boolean;
}

export interface PlaybackInfo {
	playSessionId: string;
	mediaSource: SampleVideo & {
		mediaSourceId: string;
		streamUrl: string;
	};
	expiresAt: string;
}

interface SampleEntry extends SampleVideo {
	rootId: string;
	relativePath: string;
}

const base64Url = (value: Buffer | string) => Buffer.from(value).toString("base64url");

/**
 * Issues streamer tokens for the videos found in the media libraries. The streamer learns the
 * root folders (STREAM_MEDIA_ROOT) from flixer, so root IDs always match.
 */
@Injectable()
export class PlaybackService {

	constructor(
		private readonly authService: AuthService,
		private readonly libraries: MediaLibrariesService,
		private readonly roots: MediaRootsService,
		@Inject(DefaultDataSource) private readonly dataSource: DataSource,
	) {}

	async listSamples(authorization?: string): Promise<SampleVideo[]> {
		await this.authService.getAuthenticatedUser(authorization);
		return (await this.scanSamples()).map(({ relativePath: _relativePath, rootId: _rootId, ...sample }) => sample);
	}

	async createPlaybackInfo(sampleId: string, authorization?: string): Promise<PlaybackInfo> {
		const user = await this.authService.getAuthenticatedUser(authorization);
		const sample = (await this.scanSamples()).find((entry) => entry.id === sampleId);
		if (!sample) {
			throw new NotFound("Sample video not found.");
		}
		return this.issue(user.id, sample);
	}

	/** Playback for an indexed media item, using the root and path the indexer recorded for its file. */
	async createItemPlaybackInfo(itemId: string, authorization?: string): Promise<PlaybackInfo & { title: string }> {
		const user = await this.authService.getAuthenticatedUser(authorization);
		const item = await this.dataSource.getRepository(MediaItem).findOneBy({ id: itemId });
		if (!item || item.isPlaceholder) {
			throw new NotFound("Media item not found.");
		}
		if (!PLAYABLE_TYPES.includes(item.type) || !item.rootId || !item.relativePath) {
			throw new BadRequest("This item has no file to play.");
		}
		const extension = extname(item.relativePath).toLowerCase();
		if (!SAMPLE_EXTENSIONS.has(extension) && !AUDIO_EXTENSIONS.has(extension)) {
					throw new BadRequest("This file type can't be played in the browser yet.");
				}
		const info = this.issue(user.id, {
			id: item.id,
			title: item.title,
			container: extension.slice(1),
			directPlay: extension !== ".mkv",
			rootId: item.rootId,
			relativePath: item.relativePath,
		});
		return { ...info, title: item.title };
	}

	private issue(userId: string, sample: SampleEntry): PlaybackInfo {
		const secret = this.getSecret();
		const now = Math.floor(Date.now() / 1000);
		const playSessionId = randomUUID();
		const claims = {
			iss: "flixer",
			aud: "flixer-streamer",
			sub: userId,
			userId,
			mediaItemId: sample.id,
			mediaSourceId: sample.id,
			playSessionId,
			mediaLocator: this.encryptLocator({ rootId: sample.rootId, relativePath: sample.relativePath }, secret),
			iat: now,
			exp: now + TOKEN_LIFETIME_SECONDS,
			jti: randomUUID(),
		};
		const signingInput = `${base64Url(JSON.stringify({ alg: "HS256", typ: "JWT" }))}.${base64Url(JSON.stringify(claims))}`;
		const signature = createHmac("sha256", secret).update(signingInput).digest("base64url");
		// Relative by default so clients reach the streamer through the same origin (proxy or Vite dev server).
		const streamerUrl = (appConfig().get("streamerPublicUrl") || "").replace(/\/+$/, "");

		const { relativePath: _relativePath, rootId: _rootId, ...publicSample } = sample;
		return {
			playSessionId,
			mediaSource: {
				...publicSample,
				mediaSourceId: sample.id,
				streamUrl: `${streamerUrl}/stream/${signingInput}.${signature}`,
			},
			expiresAt: new Date(claims.exp * 1000).toISOString(),
		};
	}

	private getSecret(): Buffer {
		const secret = Buffer.from(appConfig().get("streamTokenSecret") ?? "");
		if (secret.length < 32) {
			throw new Error("STREAM_TOKEN_SECRET must be set to at least 32 bytes to issue stream tokens.");
		}
		return secret;
	}

	private encryptLocator(locator: { rootId: string; relativePath: string }, secret: Buffer): string {
		const key = createHash("sha256").update(Buffer.concat([Buffer.from(`${LOCATOR_AAD}\0`), secret])).digest();
		const nonce = randomBytes(12);
		const cipher = createCipheriv("aes-256-gcm", key, nonce);
		cipher.setAAD(Buffer.from(LOCATOR_AAD));
		const ciphertext = Buffer.concat([cipher.update(JSON.stringify(locator), "utf8"), cipher.final()]);
		return base64Url(Buffer.concat([nonce, ciphertext, cipher.getAuthTag()]));
	}

	/** Finds the video files inside every folder of every media library. */
	private async scanSamples(): Promise<SampleEntry[]> {
		const samples = new Map<string, SampleEntry>();

		for (const library of await this.libraries.entities()) {
			for (const folder of library.folders) {
				const directory = await this.roots.resolveDirectory(folder.rootId, folder.path).catch(() => null);
				if (!directory) {
					continue;
				}
				const entries = await readdir(directory, { recursive: true, withFileTypes: true }).catch(() => []);

				for (const entry of entries) {
					const extension = extname(entry.name).toLowerCase();
					if (!entry.isFile() || !SAMPLE_EXTENSIONS.has(extension)) {
						continue;
					}
					const inFolder = relative(directory, join(entry.parentPath, entry.name)).split(sep).join("/");
					const relativePath = folder.path ? `${folder.path}/${inFolder}` : inFolder;
					const key = `${folder.rootId}/${relativePath}`;
					samples.set(key, {
						id: createHash("sha256").update(key).digest("hex").slice(0, 16),
						title: relativePath.replace(/\.[^.]+$/, ""),
						container: extension.slice(1),
						directPlay: extension !== ".mkv",
						rootId: folder.rootId,
						relativePath,
					});
				}
			}
		}

		return [...samples.values()].sort((a, b) => a.relativePath.localeCompare(b.relativePath));
	}
}
