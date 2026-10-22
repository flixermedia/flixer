import { Inject, Injectable } from "@tsed/di";
import { BadRequest, NotFound } from "@tsed/exceptions";
import { DataSource } from "typeorm";
import { DefaultDataSource } from "../../datasources/defaultDataSource.datasource.js";
import { MediaItem } from "../../entities/mediaItem.entity.js";
import { IndexerClient } from "../indexer/indexerClient.js";

const SUBTITLE_TYPES = ["movie", "episode", "video"];
const SUBTITLE_TIMEOUT_MS = 60_000;

export interface SubtitleTrack {
	file: string;
	language: string;
	label?: string;
	format: string;
}

export interface SubtitleResult {
	fileId: number;
	language: string;
	release: string;
	fileName: string;
	downloads: number;
	hearingImpaired: boolean;
	hashMatch: boolean;
	rating: number;
	uploader?: string;
}

/** Admin subtitle management for a video item. The indexer owns the files; flixer only describes the item. */
@Injectable()
export class SubtitleService {

	constructor(
		@Inject(DefaultDataSource) private readonly dataSource: DataSource,
		private readonly indexer: IndexerClient,
	) {}

	async list(id: string): Promise<{ tracks: SubtitleTrack[]; configured: boolean }> {
		const item = await this.video(id);
		return this.indexer.request("POST", "/internal/subtitles/list", { body: { path: item.path } });
	}

	async search(id: string, options: { query?: string; languages?: string[] }): Promise<{ results: SubtitleResult[] }> {
		const item = await this.video(id);
		return this.indexer.request("POST", "/internal/subtitles/search", {
			body: { ...(await this.describe(item)), query: options.query?.trim() || undefined, languages: options.languages?.length ? options.languages : undefined },
			timeoutMs: SUBTITLE_TIMEOUT_MS,
		});
	}

	async download(id: string, fileId: number, language: string): Promise<{ file: string }> {
		const item = await this.video(id);
		return this.indexer.request("POST", "/internal/subtitles/download", { body: { path: item.path, fileId, language }, timeoutMs: SUBTITLE_TIMEOUT_MS });
	}

	async remove(id: string, file: string): Promise<void> {
		const item = await this.video(id);
		await this.indexer.request("POST", "/internal/subtitles/delete", { body: { path: item.path, file } });
	}

	private async video(id: string): Promise<MediaItem> {
		const item = await this.dataSource.getRepository(MediaItem).findOneBy({ id });
		if (!item) {
			throw new NotFound("Media item not found.");
		}
		if (!SUBTITLE_TYPES.includes(item.type)) {
			throw new BadRequest("Subtitles are only available for movies, episodes and videos.");
		}
		return item;
	}

	private async describe(item: MediaItem) {
		const parent = item.parentId ? await this.dataSource.getRepository(MediaItem).findOneBy({ id: item.parentId }) : null;
		const series = item.type === "episode" && parent?.parentId ? await this.dataSource.getRepository(MediaItem).findOneBy({ id: parent.parentId }) : parent;
		return {
			path: item.path,
			type: item.type,
			title: item.title,
			year: item.year ?? undefined,
			season: item.seasonNumber ?? undefined,
			episode: item.episodeNumber ?? undefined,
			providerIds: item.providerIds,
			seriesTitle: item.type === "episode" ? series?.title : undefined,
			seriesProviderIds: item.type === "episode" ? series?.providerIds : undefined,
		};
	}
}
