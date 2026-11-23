import { Inject, Injectable } from "@tsed/di";
import { DataSource, type ObjectLiteral, type SelectQueryBuilder } from "typeorm";
import { DefaultDataSource } from "../../datasources/defaultDataSource.datasource.js";
import { Favorite } from "../../entities/favorite.entity.js";
import { MediaItem } from "../../entities/mediaItem.entity.js";
import { RecommendationFeedback } from "../../entities/userMediaQueue.entity.js";
import { WatchProgress } from "../../entities/watchProgress.entity.js";

const CANDIDATE_LIMIT = 20_000;
const HISTORY_LIMIT = 500;
const FAVORITE_LIMIT = 500;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface ItemRow {
	id: string;
	type: string;
	title: string;
	year: number | null;
	overview: string | null;
	tagline: string | null;
	genres: unknown;
	studios: unknown;
	cast: unknown;
	crew: unknown;
	artist: string | null;
	parent_title?: string | null;
	parent_genres?: unknown;
	position_seconds?: number;
	duration_seconds?: number;
	completed?: boolean;
	updated_at?: Date | string;
	created_at?: Date | string;
	feedback?: "dismiss" | "more_like_this" | "less_like_this";
}

function arrayValue(value: unknown): unknown[] {

	if (Array.isArray(value)) return value;
	if (typeof value !== "string") return [];
	try {
		const parsed: unknown = JSON.parse(value);
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}

}

function stringArrayValue(value: unknown): string[] {
	return arrayValue(value).flatMap((entry) => {
		if (typeof entry === "string") return [entry];
		if (typeof entry !== "object" || entry === null) return [];
		const item = entry as Record<string, unknown>;
		if (typeof item.name === "string") return [item.name];
		return typeof item.title === "string" ? [item.title] : [];
	});
}

function mapItem(row: ItemRow) {
	return {
		id: row.id,
		type: row.type,
		title: row.title,
		year: row.year,
		overview: row.overview,
		tagline: row.tagline,
		genres: stringArrayValue(row.genres),
		studios: stringArrayValue(row.studios),
		cast: arrayValue(row.cast),
		crew: arrayValue(row.crew),
		artist: row.artist,
		...(row.parent_title ? { parent_title: row.parent_title } : {}),
		...(row.parent_genres !== undefined ? { parent_genres: stringArrayValue(row.parent_genres) } : {}),
	};
}

@Injectable()
export class AiDataService {

	constructor(@Inject(DefaultDataSource) private readonly dataSource: DataSource) {}

	async libraryContext() {
		const candidates = await this.dataSource
			.getRepository(MediaItem)
			.createQueryBuilder("item")
			.select("item.id", "id")
			.addSelect("item.type", "type")
			.addSelect("item.title", "title")
			.addSelect("item.year", "year")
			// RAW SQL: PostgreSQL JSONB operators extract recommendation metadata.
			.addSelect("item.metadata ->> 'overview'", "overview")
			.addSelect("item.metadata ->> 'tagline'", "tagline")
			.addSelect("item.metadata -> 'genres'", "genres")
			.addSelect("item.metadata -> 'studios'", "studios")
			.addSelect("item.metadata -> 'cast'", "cast")
			.addSelect("item.metadata -> 'crew'", "crew")
			.addSelect("COALESCE(item.metadata ->> 'artist', item.metadata ->> 'albumArtist')", "artist")
			.where("item.isPlaceholder = false")
			.andWhere("item.type IN ('movie', 'series', 'video', 'album', 'track')")
			.orderBy("item.id", "ASC")
			.take(CANDIDATE_LIMIT)
			.getRawMany<ItemRow>();

		return { candidates: candidates.map(mapItem), history: [], favorites: [] };
	}

	async recommendationContext(userId: string) {
		const [library, history, favorites, feedback] = await Promise.all([this.libraryContext(), this.historyQuery(userId), this.favoriteQuery(userId), this.feedbackQuery(userId)]);

		return {
			...library,
			history: history.map((row) => ({
				...mapItem(row),
				position_seconds: row.position_seconds ?? 0,
				duration_seconds: row.duration_seconds ?? 0,
				completed: row.completed ?? false,
				updated_at: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
			})),
			favorites: favorites.map((row) => ({
				...mapItem(row),
				created_at: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
			})),
			feedback: feedback.map((row) => ({ ...mapItem(row), feedback: row.feedback })),
		};
	}

	static isUserId(value: string): boolean {
		return UUID_PATTERN.test(value);
	}

	private itemProjection<T extends ObjectLiteral>(query: SelectQueryBuilder<T>): SelectQueryBuilder<T> {
		return (
			query
				.select("item.id", "id")
				.addSelect("item.type", "type")
				.addSelect("item.title", "title")
				.addSelect("item.year", "year")
				// RAW SQL: PostgreSQL JSONB operators extract recommendation metadata.
				.addSelect("item.metadata ->> 'overview'", "overview")
				.addSelect("item.metadata ->> 'tagline'", "tagline")
				.addSelect("item.metadata -> 'genres'", "genres")
				.addSelect("item.metadata -> 'studios'", "studios")
				.addSelect("item.metadata -> 'cast'", "cast")
				.addSelect("item.metadata -> 'crew'", "crew")
				.addSelect("COALESCE(item.metadata ->> 'artist', item.metadata ->> 'albumArtist')", "artist")
		);
	}

	private async historyQuery(userId: string): Promise<ItemRow[]> {
		return this.itemProjection(this.dataSource.getRepository(WatchProgress).createQueryBuilder("w").innerJoin(MediaItem, "item", "item.id = w.itemId").leftJoin(MediaItem, "season", "season.id = item.parentId AND item.type = 'episode'").leftJoin(MediaItem, "parent", "parent.id = CASE WHEN item.type = 'episode' THEN season.parentId ELSE item.parentId END"))
			.addSelect("parent.title", "parent_title")
			.addSelect("parent.metadata -> 'genres'", "parent_genres")
			.addSelect("w.positionSeconds", "position_seconds")
			.addSelect("w.durationSeconds", "duration_seconds")
			.addSelect("w.completed", "completed")
			.addSelect("w.updatedAt", "updated_at")
			.where("w.userId = :userId", { userId })
			.andWhere("item.isPlaceholder = false")
			.andWhere("item.type IN ('movie', 'episode', 'video', 'album', 'track')")
			.orderBy("w.updatedAt", "DESC")
			.take(HISTORY_LIMIT)
			.getRawMany<ItemRow>();
	}

	private async favoriteQuery(userId: string): Promise<ItemRow[]> {
		return this.itemProjection(this.dataSource.getRepository(Favorite).createQueryBuilder("favorite").innerJoin(MediaItem, "item", "item.id = favorite.itemId"))
			.addSelect("favorite.createdAt", "created_at")
			.where("favorite.userId = :userId", { userId })
			.andWhere("item.isPlaceholder = false")
			.orderBy("favorite.createdAt", "DESC")
			.take(FAVORITE_LIMIT)
			.getRawMany<ItemRow>();
	}

	private async feedbackQuery(userId: string): Promise<ItemRow[]> {
		const query = this.dataSource.getRepository(RecommendationFeedback).createQueryBuilder("feedback").innerJoin(MediaItem, "item", "item.id = feedback.itemId");
		return this.itemProjection(query).addSelect("feedback.feedback", "feedback").where("feedback.userId = :userId", { userId }).andWhere("item.isPlaceholder = false").orderBy("feedback.updatedAt", "DESC").getRawMany<ItemRow>();
	}
}
