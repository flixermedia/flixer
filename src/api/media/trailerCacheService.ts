import { Injectable, logger } from "@tsed/di";
import { BadGateway, BadRequest, NotFound, ServiceUnavailable } from "@tsed/exceptions";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rename, rm, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { dataPath } from "../../config/dataPath.js";

const execFileAsync = promisify(execFile);
const MAX_BYTES = 250 * 1024 * 1024;
const TIMEOUT_MS = 180_000;
const MAX_CONCURRENT = 2;
const MAX_PENDING = 100;
export const TRAILER_ROOT_ID = "flixer-trailers";

/** Storage and remote resolution for trailers. */
@Injectable()
export class TrailerCacheService {
	private readonly pending = new Map<string, Promise<void>>();
	private readonly waiters: Array<() => void> = [];
	private active = 0;

	private filename(id: string, tmdbId: string): string {
		if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) || !/^[1-9]\d*$/.test(tmdbId)) {
			throw new BadRequest("Invalid trailer identity.");
		}
		return `${id.toLowerCase()}-${tmdbId}.mp4`;
	}

	async find(id: string, tmdbId: string): Promise<string | null> {
		const name = this.filename(id, tmdbId);
		try {
			const info = await stat(dataPath("cache", "trailers", name));
			if (!info.isFile() || info.size === 0 || info.size > MAX_BYTES) {
				throw new Error("Cached trailer is not a valid file.");
			}
			return name;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
			throw error;
		}
	}

	async download(id: string, tmdbId: string, key: string): Promise<void> {
		const name = this.filename(id, tmdbId);
		if (!/^[A-Za-z0-9_-]{11}$/.test(key)) throw new BadRequest("Invalid trailer video ID.");
		const current = this.pending.get(name);
		if (current) return current;
		if (this.pending.size >= MAX_PENDING) throw new ServiceUnavailable("Trailer cache queue is full. Try again later.");
		const download = this.runDownload(name, key);
		this.pending.set(name, download);
		try {
			await download;
		} finally {
			this.pending.delete(name);
		}
	}

	private async runDownload(name: string, key: string): Promise<void> {
		if (this.active >= MAX_CONCURRENT) {
			await new Promise<void>((resolve) => this.waiters.push(resolve));
		} else {
			this.active++;
		}
		try {
			await this.downloadFile(name, key);
		} finally {
			const next = this.waiters.shift();
			if (next) next();
			else this.active--;
		}
	}

	queue(id: string, tmdbId: string, key: string): void {
		void this.download(id, tmdbId, key).catch((error: unknown) => {
			logger().warn(`Could not cache trailer for item ${id}.`, error);
		});
	}

	async remoteUrl(key: string): Promise<string> {
		if (!/^[A-Za-z0-9_-]{11}$/.test(key)) throw new BadRequest("Invalid trailer video ID.");
		let stdout: string;
		try {
			({ stdout } = await execFileAsync("yt-dlp", [
				"--ignore-config", "--no-playlist", "--no-cache-dir", "--js-runtimes", "node", "--extractor-args", "youtube:player_client=android",
				"--match-filter", "duration <= 1200 & !is_live", "--get-url",
				"-f", "b[ext=mp4][vcodec^=avc1][acodec^=mp4a]",
				"--", `https://www.youtube.com/watch?v=${key}`,
			], { timeout: 30_000, maxBuffer: 1024 * 1024 }));
		} catch (error) {
			logger().warn("Could not resolve a remote trailer.", error);
			if ((error as NodeJS.ErrnoException).code === "ENOENT") {
				throw new ServiceUnavailable("Trailer playback requires yt-dlp on the API server's PATH.");
			}
			throw new BadGateway("The trailer provider could not supply a playable video.");
		}
		const raw = stdout.trim();
		let url: URL;
		try {
			url = new URL(raw);
		} catch {
			throw new BadGateway("The trailer provider returned an invalid video URL.");
		}
		if (url.protocol !== "https:" || url.username || url.password || url.port || !url.hostname.endsWith(".googlevideo.com") || raw.length > 3500) {
			throw new BadGateway("The trailer provider returned an unsupported video URL.");
		}
		return raw;
	}

	private async downloadFile(name: string, key: string): Promise<void> {
		const directory = dataPath("cache", "trailers");
		await mkdir(directory, { recursive: true });
		const temp = await mkdtemp(join(directory, ".download-"));
		try {
			const output = join(temp, "trailer.mp4");
			try {
				await execFileAsync("yt-dlp", ["--ignore-config", "--no-playlist", "--no-cache-dir", "--no-progress", "--js-runtimes", "node", "--match-filter", "duration <= 1200 & !is_live", "--max-filesize", String(MAX_BYTES), "--merge-output-format", "mp4", "-f", "bv*[ext=mp4][vcodec^=avc1][height<=1080]+ba[ext=m4a][acodec^=mp4a]/b[ext=mp4][vcodec^=avc1][acodec^=mp4a]", "-o", output, "--", `https://www.youtube.com/watch?v=${key}`], { timeout: TIMEOUT_MS, maxBuffer: 1024 * 1024 });
			} catch (error) {
				throw new BadGateway(`Trailer download failed: ${error instanceof Error ? error.message : "unknown error"}`);
			}
			let info;
			try {
				info = await stat(output);
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new BadGateway("No eligible trailer file was downloaded.");
				throw error;
			}
			if (!info.isFile() || info.size === 0 || info.size > MAX_BYTES) {
				throw new BadGateway("The downloaded trailer is empty or exceeds 250 MiB.");
			}
			await rename(output, join(directory, name));
		} finally {
			await rm(temp, { recursive: true, force: true });
		}
	}

	async remove(id: string, tmdbId: string): Promise<void> {
		const name = this.filename(id, tmdbId);
		const current = this.pending.get(name);
		if (current) await current;
		try {
			await unlink(dataPath("cache", "trailers", name));
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new NotFound("Cached trailer not found.");
			throw error;
		}
	}
}
