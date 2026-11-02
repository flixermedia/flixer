import { Inject, Injectable } from "@tsed/di";
import { DataSource } from "typeorm";
import { DefaultDataSource } from "../../datasources/defaultDataSource.datasource.js";

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
		const candidates = (await this.dataSource.query(
			`SELECT id, type, title, year,
				metadata ->> 'overview' AS overview,
				metadata ->> 'tagline' AS tagline,
				metadata -> 'genres' AS genres,
				metadata -> 'studios' AS studios,
				metadata -> 'cast' AS cast,
				metadata -> 'crew' AS crew,
				COALESCE(metadata ->> 'artist', metadata ->> 'albumArtist') AS artist
			FROM media_items
			WHERE is_placeholder = false AND type IN ('movie', 'series', 'video', 'album', 'track')
			ORDER BY id
			LIMIT $1`,
			[CANDIDATE_LIMIT],
		)) as ItemRow[];

		return { candidates: candidates.map(mapItem), history: [], favorites: [] };
	}

	async recommendationContext(userId: string) {
		const [library, history, favorites] = await Promise.all([
			this.libraryContext(),
			this.dataSource.query(
				`SELECT i.id, i.type, i.title, i.year,
					i.metadata ->> 'overview' AS overview,
					i.metadata ->> 'tagline' AS tagline,
					i.metadata -> 'genres' AS genres,
					i.metadata -> 'studios' AS studios,
					i.metadata -> 'cast' AS cast,
					i.metadata -> 'crew' AS crew,
					COALESCE(i.metadata ->> 'artist', i.metadata ->> 'albumArtist') AS artist,
					parent.title AS parent_title,
					parent.metadata -> 'genres' AS parent_genres,
					w.position_seconds, w.duration_seconds, w.completed, w.updated_at
				FROM watch_progress w
				JOIN media_items i ON i.id = w.item_id
				LEFT JOIN media_items season ON season.id = i.parent_id AND i.type = 'episode'
				LEFT JOIN media_items parent ON parent.id = CASE WHEN i.type = 'episode' THEN season.parent_id ELSE i.parent_id END
				WHERE w.user_id = $1 AND i.is_placeholder = false AND i.type IN ('movie', 'episode', 'video', 'album', 'track')
				ORDER BY w.updated_at DESC
				LIMIT $2`,
				[userId, HISTORY_LIMIT],
			) as Promise<ItemRow[]>,
			this.dataSource.query(
				`SELECT i.id, i.type, i.title, i.year,
					i.metadata ->> 'overview' AS overview,
					i.metadata ->> 'tagline' AS tagline,
					i.metadata -> 'genres' AS genres,
					i.metadata -> 'studios' AS studios,
					i.metadata -> 'cast' AS cast,
					i.metadata -> 'crew' AS crew,
					COALESCE(i.metadata ->> 'artist', i.metadata ->> 'albumArtist') AS artist,
					f.created_at
				FROM favorites f
				JOIN media_items i ON i.id = f.item_id
				WHERE f.user_id = $1 AND i.is_placeholder = false
				ORDER BY f.created_at DESC
				LIMIT $2`,
				[userId, FAVORITE_LIMIT],
			) as Promise<ItemRow[]>,
		]);

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
		};
	}

	static isUserId(value: string): boolean {
		return UUID_PATTERN.test(value);
	}
}
