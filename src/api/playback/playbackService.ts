import { Injectable } from "@tsed/di";
import { NotFound } from "@tsed/exceptions";
import { createCipheriv, createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { readdir } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { AuthService } from "../auth/authService.js";

const TOKEN_LIFETIME_SECONDS = 60 * 60;
const LOCATOR_AAD = "flixer-streamer:media-locator:v1";
const SAMPLE_EXTENSIONS = new Set([".mp4", ".webm", ".mkv"]);
const MEDIA_ROOT_ID = "root-1";

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
	relativePath: string;
}

const base64Url = (value: Buffer | string) => Buffer.from(value).toString("base64url");

/**
 * Issues streamer tokens for the sample videos found in STREAM_MEDIA_ROOT.
 * STREAM_MEDIA_ROOT must be the first entry of the streamer's MEDIA_ROOTS.
 */
@Injectable()
export class PlaybackService {

	constructor(private readonly authService: AuthService) {}

	async listSamples(authorization?: string): Promise<SampleVideo[]> {
		await this.authService.getAuthenticatedUser(authorization);
		return (await this.scanSamples()).map(({ relativePath: _relativePath, ...sample }) => sample);
	}

	async createPlaybackInfo(sampleId: string, authorization?: string): Promise<PlaybackInfo> {
		const user = await this.authService.getAuthenticatedUser(authorization);
		const sample = (await this.scanSamples()).find((entry) => entry.id === sampleId);
		if (!sample) {
			throw new NotFound("Sample video not found.");
		}

		const secret = this.getSecret();
		const now = Math.floor(Date.now() / 1000);
		const playSessionId = randomUUID();
		const claims = {
			iss: "flixer",
			aud: "flixer-streamer",
			sub: user.id,
			userId: user.id,
			mediaItemId: sample.id,
			mediaSourceId: sample.id,
			playSessionId,
			mediaLocator: this.encryptLocator({ rootId: MEDIA_ROOT_ID, relativePath: sample.relativePath }, secret),
			iat: now,
			exp: now + TOKEN_LIFETIME_SECONDS,
			jti: randomUUID(),
		};
		const signingInput = `${base64Url(JSON.stringify({ alg: "HS256", typ: "JWT" }))}.${base64Url(JSON.stringify(claims))}`;
		const signature = createHmac("sha256", secret).update(signingInput).digest("base64url");
		// Relative by default so clients reach the streamer through the same origin (proxy or Vite dev server).
		const streamerUrl = (process.env.STREAMER_PUBLIC_URL || "").replace(/\/+$/, "");

		const { relativePath: _relativePath, ...publicSample } = sample;
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
		const secret = Buffer.from(process.env.STREAM_TOKEN_SECRET?.trim() ?? "");
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

	private async scanSamples(): Promise<SampleEntry[]> {
		const root = resolve(process.env.STREAM_MEDIA_ROOT || "../flixer-data/media");
		const entries = await readdir(root, { recursive: true, withFileTypes: true }).catch(() => []);
		const samples: SampleEntry[] = [];

		for (const entry of entries) {
			const extension = extname(entry.name).toLowerCase();
			if (!entry.isFile() || !SAMPLE_EXTENSIONS.has(extension)) {
				continue;
			}
			const relativePath = resolve(entry.parentPath, entry.name).slice(root.length + 1).split(sep).join("/");
			samples.push({
				id: createHash("sha256").update(relativePath).digest("hex").slice(0, 16),
				title: relativePath.replace(/\.[^.]+$/, ""),
				container: extension.slice(1),
				directPlay: extension !== ".mkv",
				relativePath,
			});
		}

		return samples.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
	}
}
