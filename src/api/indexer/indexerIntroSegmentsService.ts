import { BadRequest, NotFound } from "@tsed/exceptions";
import { Inject, Injectable } from "@tsed/di";
import { DataSource, In, MoreThan } from "typeorm";
import { DefaultDataSource } from "../../datasources/defaultDataSource.datasource.js";
import { MediaItem } from "../../entities/mediaItem.entity.js";
import { MediaSegment } from "../../entities/mediaSegment.entity.js";

const INTRO_TYPES = ["intro", "credits"] as const;
type IntroType = (typeof INTRO_TYPES)[number];
type TimedSegment = { startMs: number; endMs: number };

export interface IntroSyncCandidate {
	id: string;
	type: "movie" | "episode";
	providerIds: Record<string, string>;
	durationMs?: number;
	season?: number;
	episode?: number;
}

export interface IntroSegmentUpdate {
	itemId: string;
	segments: Partial<Record<IntroType, TimedSegment | null>>;
}

export type ExistingIntroSegments = Partial<Record<IntroType, true>>;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_SEGMENT_MS = 7 * 24 * 60 * 60 * 1000;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseIntroSegmentUpdate(value: unknown): IntroSegmentUpdate {
	if (
		!isRecord(value) ||
		typeof value.itemId !== "string" ||
		!UUID_PATTERN.test(value.itemId) ||
		!isRecord(value.segments)
	) {
		throw new BadRequest("itemId and a segments object are required.");
	}
	const segments: IntroSegmentUpdate["segments"] = {};
	for (const [type, segment] of Object.entries(value.segments)) {
		if (!INTRO_TYPES.includes(type as IntroType)) {
			throw new BadRequest(`Unsupported TheIntroDB segment type "${type}".`);
		}
		if (segment === null) {
			segments[type as IntroType] = null;
			continue;
		}
		if (
			!isRecord(segment) ||
			typeof segment.startMs !== "number" ||
			!Number.isSafeInteger(segment.startMs) ||
			typeof segment.endMs !== "number" ||
			!Number.isSafeInteger(segment.endMs) ||
			segment.startMs < 0 ||
			segment.endMs <= segment.startMs ||
			segment.endMs > MAX_SEGMENT_MS
		) {
			throw new BadRequest("Segment times must be valid whole milliseconds.");
		}
		segments[type as IntroType] = { startMs: segment.startMs, endMs: segment.endMs };
	}
	return { itemId: value.itemId.toLowerCase(), segments };
}

/** Provides a paged backfill feed and replaces provider-owned timing rows. */
@Injectable()
export class IndexerIntroSegmentsService {
	constructor(@Inject(DefaultDataSource) private readonly dataSource: DataSource) {}

	async existing(itemId: string): Promise<ExistingIntroSegments> {
		const rows = await this.dataSource.getRepository(MediaSegment).find({
			where: { itemId, type: In(INTRO_TYPES) },
			select: ["type"],
		});
		const existing: ExistingIntroSegments = {};
		for (const { type } of rows) {
			existing[type] = true;
		}
		return existing;
	}

	async candidates(
		type: "movie" | "episode",
		afterId: string | undefined,
		limit: number,
		libraryId?: string,
	): Promise<{ items: IntroSyncCandidate[]; nextCursor: string | null }> {
		const repository = this.dataSource.getRepository(MediaItem);
		const where: Record<string, unknown> = { type, isPlaceholder: false };
		if (libraryId) {
			where.libraryId = libraryId;
		}
		if (afterId) {
			if (!UUID_PATTERN.test(afterId)) {
				throw new BadRequest("afterId must be a media item id.");
			}
			where.id = MoreThan(afterId.toLowerCase());
		}
		const items = await repository.find({ where, order: { id: "ASC" }, take: limit });
		const seasons =
			type === "episode" && items.length
				? await repository.find({
						where: { id: In(items.map((item) => item.parentId).filter((id): id is string => Boolean(id))) },
					})
				: [];
		const series = seasons.length
			? await repository.find({
					where: {
						id: In(seasons.map((item) => item.parentId).filter((id): id is string => Boolean(id))),
						type: "series",
					},
				})
			: [];
		const seasonsById = new Map(seasons.map((item) => [item.id, item]));
		const seriesById = new Map(series.map((item) => [item.id, item]));
		const output = items.map((item): IntroSyncCandidate => {
			const providerIds =
				type === "movie"
					? (item.providerIds ?? {})
					: (seriesById.get(seasonsById.get(item.parentId ?? "")?.parentId ?? "")?.providerIds ?? {});
			const duration = Number(item.technical?.duration ?? 0);
			const durationMs = Number.isFinite(duration) && duration > 0 ? Math.round(duration * 1000) : undefined;
			return {
				id: item.id,
				type,
				providerIds,
				...(durationMs ? { durationMs } : {}),
				...(type === "episode" && item.seasonNumber !== null ? { season: item.seasonNumber } : {}),
				...(type === "episode" && item.episodeNumber !== null ? { episode: item.episodeNumber } : {}),
			};
		});
		return { items: output, nextCursor: items.length === limit ? (items.at(-1)?.id ?? null) : null };
	}

	async replace(update: IntroSegmentUpdate): Promise<void> {
		await this.dataSource.transaction(async (manager) => {
			await manager.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`flixer:theintrodb:${update.itemId}`]);
			const item = await manager.getRepository(MediaItem).findOneBy({ id: update.itemId });
			if (!item || item.isPlaceholder) {
				throw new NotFound("Media item not found.");
			}
			if (item.type !== "movie" && item.type !== "episode") {
				throw new BadRequest("TheIntroDB timings can only be saved for movies and episodes.");
			}
			const repository = manager.getRepository(MediaSegment);
			await repository.delete({ itemId: item.id, source: "theintrodb" });
			const rows = INTRO_TYPES.flatMap((type) => {
				const segment = update.segments[type];
				return segment
					? [{ itemId: item.id, type, source: "theintrodb" as const, ...segment, submissions: 0 }]
					: [];
			});
			if (rows.length) {
				await repository.save(rows);
			}
		});
	}
}
