import { Inject, Injectable } from "@tsed/di";
import { BadRequest, NotFound } from "@tsed/exceptions";
import { DataSource } from "typeorm";
import { DefaultDataSource } from "../../datasources/defaultDataSource.datasource.js";
import { MediaItem } from "../../entities/mediaItem.entity.js";
import { Setting } from "../../entities/setting.entity.js";
import { MediaAccessService } from "../access/mediaAccessService.js";
import { ExternalMetadataService } from "../requests/externalMetadataService.js";
import { AuthService } from "../auth/authService.js";
import { PlaybackService } from "../playback/playbackService.js";
import { TrailerCacheService } from "./trailerCacheService.js";

/** Resolves trailers only for media accessible to the current viewer. */
@Injectable()
export class MediaTrailerService {
	constructor(
		@Inject(DefaultDataSource) private readonly dataSource: DataSource,
		private readonly access: MediaAccessService,
		private readonly metadata: ExternalMetadataService,
		private readonly cache: TrailerCacheService,
		private readonly playback: PlaybackService,
		private readonly auth: AuthService,
	) {}

	async trailer(id: string, authorization?: string): Promise<{ key: string | null; name: string; streamUrl?: string } | null> {
		const policy = await this.access.resolve(authorization);
		const item = await this.dataSource.getRepository(MediaItem).findOneBy({ id });
		if (!item || item.isPlaceholder || !(await this.access.isVisible(policy, id))) {
			throw new NotFound("Media item not found.");
		}
		const tmdbId = item.providerIds?.tmdb;
		if ((item.type !== "movie" && item.type !== "series") || !tmdbId || !/^[1-9]\d*$/.test(tmdbId)) {
			return null;
		}
		const enabled = (await this.dataSource.getRepository(Setting).findOneBy({ key: "trailers_cache_enabled" }))?.value === true;
		const cached = enabled ? await this.cache.find(id, tmdbId) : null;
		if (cached) {
			const playback = await this.playback.issueTrailer(policy.userId, item, cached);
			return { key: null, name: item.title, streamUrl: playback.mediaSource.streamUrl };
		}
		const trailer = await this.metadata.trailer(item.type === "movie" ? "movie" : "tv", tmdbId);
		if (!trailer) return null;
		const url = await this.cache.remoteUrl(trailer.key);
		if (enabled) this.cache.queue(id, tmdbId, trailer.key);
		return { key: null, name: trailer.name, streamUrl: this.playback.issueRemoteTrailer(policy.userId, item, url) };
	}

	async cacheTrailer(id: string, authorization?: string): Promise<void> {
		await this.auth.requireAdmin(authorization);
		const item = await this.dataSource.getRepository(MediaItem).findOneBy({ id, isPlaceholder: false });
		const tmdbId = item?.providerIds?.tmdb;
		if (!item || (item.type !== "movie" && item.type !== "series") || !tmdbId || !/^[1-9]\d*$/.test(tmdbId)) {
			throw new BadRequest("This title has no valid TMDB identifier.");
		}
		const trailer = await this.metadata.trailer(item.type === "movie" ? "movie" : "tv", tmdbId);
		if (!trailer) throw new NotFound("No YouTube trailer is available for this title.");
		await this.cache.download(item.id, tmdbId, trailer.key);
	}

	async removeTrailer(id: string, authorization?: string): Promise<void> {
		await this.auth.requireAdmin(authorization);
		const item = await this.dataSource.getRepository(MediaItem).findOneBy({ id, isPlaceholder: false });
		const tmdbId = item?.providerIds?.tmdb;
		if (!item || !tmdbId || !/^[1-9]\d*$/.test(tmdbId)) throw new NotFound("Cached trailer not found.");
		await this.cache.remove(item.id, tmdbId);
	}
}
