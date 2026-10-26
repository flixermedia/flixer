import { Inject, Injectable } from "@tsed/di";
import { BadRequest } from "@tsed/exceptions";
import { DataSource } from "typeorm";
import { DefaultDataSource } from "../../datasources/defaultDataSource.datasource.js";
import { MediaItem } from "../../entities/mediaItem.entity.js";
import { Setting } from "../../entities/setting.entity.js";
import { MediaSegment, SEGMENT_TYPES, type SegmentType } from "../../entities/mediaSegment.entity.js";
import { PluginSegmentProvider } from "../plugins/pluginSegmentProvider.js";
import {
	SKIPME_API_URL_KEY,
	type Chapter,
	type ResolvedSegment,
	type SkipmeTimestamp,
	chapterSegments,
	mergeSegments,
	parseChapters,
	pickSkipmeTimestamp,
} from "./segmentLogic.js";

const SKIPME_TYPES: SegmentType[] = ["intro", "recap", "credits", "preview"];
const SKIPME_TIMEOUT_MS = 4000;
/** A lookup that found nothing, or failed, isn't repeated for this long. */
const SKIPME_RETRY_MS = 24 * 60 * 60 * 1000;
const MAX_SERIES_DEPTH = 3;

export interface ItemSegments {
	chapters: Chapter[];
	segments: ResolvedSegment[];
}

type SkipmeMedia = Partial<Record<SegmentType, SkipmeTimestamp[]>>;

/** Combines an item's chapters, crowd-sourced SkipMe.db timestamps and admin overrides into skippable segments. */
@Injectable()
export class MediaSegmentsService {
	private readonly skipmeChecked = new Map<string, number>();

	constructor(
		@Inject(DefaultDataSource) private readonly dataSource: DataSource,
		private readonly provider: PluginSegmentProvider,
	) {}

	async forItem(item: MediaItem): Promise<ItemSegments> {
		await this.syncSkipme(item);
		const stored = await this.dataSource.getRepository(MediaSegment).findBy({ itemId: item.id });
		const chapters = parseChapters(item.technical);
		const candidates: ResolvedSegment[] = [
			...chapterSegments(chapters),
			...stored.map((row) => ({ type: row.type, startMs: row.startMs, endMs: row.endMs, source: row.source })),
		];
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

	/** The admin-set SkipMe.db URL; an empty value turns lookups off. */
	private async skipmeBaseUrl(): Promise<string> {
		const stored = (await this.dataSource.getRepository(Setting).findOneBy({ key: SKIPME_API_URL_KEY }))?.value;
		return typeof stored === "string" ? stored.trim() : "";
	}

	private async syncSkipme(item: MediaItem): Promise<void> {
		const base = (await this.skipmeBaseUrl()).replace(/\/+$/, "");
		if (!base || (item.type !== "movie" && item.type !== "episode")) {
			return;
		}
		const checkedAt = this.skipmeChecked.get(item.id);
		if (checkedAt !== undefined && Date.now() - checkedAt < SKIPME_RETRY_MS) {
			return;
		}
		this.skipmeChecked.set(item.id, Date.now());

		const durationMs = Math.round(Number(item.technical?.duration ?? 0) * 1000);
		const request = await this.buildLookup(item, durationMs);
		if (!request) {
			return;
		}
		if (await this.syncFromProvider(item, request, base)) {
			return;
		}
		const media = await this.fetchSkipme(base, request);
		if (!media) {
			return;
		}
		const repo = this.dataSource.getRepository(MediaSegment);
		for (const type of SKIPME_TYPES) {
			const pick = pickSkipmeTimestamp(media[type], durationMs);
			if (pick) {
				await repo.save({ itemId: item.id, type, source: "skipme", ...pick });
			} else {
				await repo.delete({ itemId: item.id, type, source: "skipme" });
			}
		}
	}

	/** Delegates to an enabled segment-provider plugin; returns false only when none is active. */
	private async syncFromProvider(
		item: MediaItem,
		request: Record<string, unknown>,
		baseUrl: string,
	): Promise<boolean> {
		const ids: Record<string, string> = {};
		if (request.tmdb_id) ids.tmdb = String(request.tmdb_id);
		if (request.tvdb_id) ids.tvdb = String(request.tvdb_id);
		if (typeof request.imdb_id === "string") ids.imdb = request.imdb_id;
		const outcome = await this.provider.lookup(
			{
				type: item.type as "movie" | "episode",
				durationMs: Number(request.duration_ms),
				providerIds: ids,
				...(typeof request.season === "number" ? { season: request.season } : {}),
				...(typeof request.episode === "number" ? { episode: request.episode } : {}),
			},
			{ baseUrl },
		);
		if (outcome.status === "no-provider") {
			return false;
		}
		if (outcome.status === "ok") {
			const repo = this.dataSource.getRepository(MediaSegment);
			for (const type of SKIPME_TYPES) {
				const pick = outcome.segments[type];
				if (pick) {
					await repo.save({ itemId: item.id, type, source: "skipme", ...pick });
				} else if (pick === null) {
					await repo.delete({ itemId: item.id, type, source: "skipme" });
				}
			}
		}
		return true;
	}

	/** Episodes are looked up by their series' ids plus season and episode number. */
	private async buildLookup(item: MediaItem, durationMs: number): Promise<Record<string, unknown> | null> {
		let source = item;
		if (item.type === "episode") {
			const series = await this.findSeries(item);
			if (!series || item.seasonNumber === null || item.episodeNumber === null) {
				return null;
			}
			source = series;
		}
		const ids = source.providerIds ?? {};
		const number = (value: string | undefined) => (value && /^\d+$/.test(value) ? Number(value) : undefined);
		const request = {
			tmdb_id: number(ids.tmdb),
			tvdb_id: number(ids.tvdb),
			imdb_id: ids.imdb || undefined,
			season: item.type === "episode" ? (item.seasonNumber ?? undefined) : undefined,
			episode: item.type === "episode" ? (item.episodeNumber ?? undefined) : undefined,
			duration_ms: durationMs,
		};
		return request.tmdb_id || request.tvdb_id || request.imdb_id ? request : null;
	}

	private async findSeries(item: MediaItem): Promise<MediaItem | null> {
		const repo = this.dataSource.getRepository(MediaItem);
		let current: MediaItem | null = item;
		for (let depth = 0; depth < MAX_SERIES_DEPTH && current?.parentId; depth++) {
			current = await repo.findOneBy({ id: current.parentId });
			if (current?.type === "series") {
				return current;
			}
		}
		return null;
	}

	private async fetchSkipme(base: string, request: Record<string, unknown>): Promise<SkipmeMedia | null> {
		try {
			const response = await fetch(`${base}/movies`, {
				method: "POST",
				headers: { "content-type": "application/json", "user-agent": "Flixer" },
				body: JSON.stringify([request]),
				signal: AbortSignal.timeout(SKIPME_TIMEOUT_MS),
			});
			if (!response.ok) {
				return null;
			}
			const payload = (await response.json()) as (SkipmeMedia | null)[];
			return Array.isArray(payload) ? (payload[0] ?? null) : null;
		} catch {
			return null;
		}
	}
}
