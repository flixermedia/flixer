import { Inject, Injectable } from "@tsed/di";
import { BadRequest } from "@tsed/exceptions";
import { DataSource } from "typeorm";
import { DefaultDataSource } from "../../datasources/defaultDataSource.datasource.js";
import { MediaItem } from "../../entities/mediaItem.entity.js";
import { MediaSegment, SEGMENT_TYPES, type SegmentType } from "../../entities/mediaSegment.entity.js";
import { PluginSegmentProvider } from "../plugins/pluginSegmentProvider.js";
import {
	type Chapter,
	type ResolvedSegment,
	chapterSegments,
	mergeSegments,
	parseChapters,
} from "./segmentLogic.js";

const PLUGIN_TYPES: SegmentType[] = ["intro", "recap", "credits", "preview", "commercial"];

export interface ItemSegments {
	chapters: Chapter[];
	segments: ResolvedSegment[];
}

/** Combines indexed provider data, optional plugin data, chapters and admin overrides into skippable segments. */
@Injectable()
export class MediaSegmentsService {
	constructor(
		@Inject(DefaultDataSource) private readonly dataSource: DataSource,
		private readonly provider: PluginSegmentProvider,
	) {}

	async forItem(item: MediaItem): Promise<ItemSegments> {
		const stored = await this.dataSource.getRepository(MediaSegment).findBy({ itemId: item.id });
		const chapters = parseChapters(item.technical);
		const candidates: ResolvedSegment[] = [
			...chapterSegments(chapters),
			...stored.filter((row) => row.source !== "plugin").map((row) => ({ type: row.type, startMs: row.startMs, endMs: row.endMs, source: row.source })),
		];
		if (stored.length === 0) {
			await this.syncFromPlugin(item);
		}
		const pluginSegments = await this.dataSource.getRepository(MediaSegment).findBy({ itemId: item.id, source: "plugin" });
		candidates.push(...pluginSegments.map((row) => ({ type: row.type, startMs: row.startMs, endMs: row.endMs, source: row.source })));
		return { chapters, segments: mergeSegments(candidates) };
	}

	async setManual(itemId: string, type: string, startMs: number, endMs: number): Promise<void> {
		if (!SEGMENT_TYPES.includes(type as SegmentType)) {
			throw new BadRequest(`type must be one of ${SEGMENT_TYPES.join(", ")}.`);
		}
		if (!Number.isInteger(startMs) || !Number.isInteger(endMs) || startMs < 0 || endMs <= startMs) {
			throw new BadRequest("startMs and endMs must be whole milliseconds with endMs after startMs.");
		}
		await this.dataSource
			.getRepository(MediaSegment)
			.save({ itemId, type: type as SegmentType, source: "manual", startMs, endMs, submissions: 0 });
	}

	async clearManual(itemId: string, type: string): Promise<void> {
		await this.dataSource
			.getRepository(MediaSegment)
			.delete({ itemId, type: type as SegmentType, source: "manual" });
	}

	private async syncFromPlugin(item: MediaItem): Promise<void> {
		if (item.type !== "movie" && item.type !== "episode") {
			return;
		}
		const durationMs = Math.round(Number(item.technical?.duration ?? 0) * 1000);
		let providerIds = item.providerIds ?? {};
		let season: number | undefined;
		let episode: number | undefined;
		if (item.type === "episode") {
			season = item.seasonNumber ?? undefined;
			episode = item.episodeNumber ?? undefined;
			const parent = item.parentId ? await this.dataSource.getRepository(MediaItem).findOneBy({ id: item.parentId }) : null;
			const series = parent?.parentId ? await this.dataSource.getRepository(MediaItem).findOneBy({ id: parent.parentId }) : null;
			if (series?.type === "series") {
				providerIds = series.providerIds ?? {};
			}
		}
		const outcome = await this.provider.lookup(
			{
				type: item.type as "movie" | "episode",
				durationMs,
				providerIds,
				...(typeof season === "number" ? { season } : {}),
				...(typeof episode === "number" ? { episode } : {}),
			},
			{ baseUrl: "" },
		);
		if (outcome.status === "ok") {
			const repo = this.dataSource.getRepository(MediaSegment);
			for (const type of PLUGIN_TYPES) {
				const pick = outcome.segments[type];
				if (pick) {
					await repo.save({ itemId: item.id, type, source: "plugin", ...pick });
				} else if (pick === null) {
					await repo.delete({ itemId: item.id, type, source: "plugin" });
				}
			}
		}
	}
}
