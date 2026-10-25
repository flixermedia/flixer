import { parseChapters } from "./segmentLogic.js";
import { Inject, Injectable } from "@tsed/di";
import { NotFound } from "@tsed/exceptions";
import { DataSource, In } from "typeorm";
import { DefaultDataSource } from "../../datasources/defaultDataSource.datasource.js";
import { MediaCredit, personIdOf } from "../../entities/mediaCredit.entity.js";
import { MediaItem, type MediaItemType } from "../../entities/mediaItem.entity.js";
import { MediaLibrary } from "../../entities/mediaLibrary.entity.js";
import { PersonProfile } from "../../entities/personProfile.entity.js";
import { WatchProgress } from "../../entities/watchProgress.entity.js";
import { IndexerClient } from "../indexer/indexerClient.js";
import { normalizeWidth, resizeImage } from "./mediaImageResizer.js";
import { allowedPersonImage, fetchPersonImage } from "./personImages.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PROFILE_REFRESH_MS = 180 * 24 * 60 * 60 * 1000;
const PROFILE_RETRY_MS = 14 * 24 * 60 * 60 * 1000;
const PROFILE_LINK_PREFIXES = ["https://en.wikipedia.org/", "https://www.discogs.com/"];

export interface PersonProfileView {
	description: string | null;
	biography: string | null;
	source: string | null;
	sourceUrl: string | null;
}

function toProfileView(row: PersonProfile): PersonProfileView | null {
	return row.biography || row.description ? { description: row.description, biography: row.biography, source: row.source, sourceUrl: row.sourceUrl } : null;
}

const ROLE_ORDER = ["artist", "actor", "director", "writer", "producer", "composer"];
const FEATURED_COUNT = 5;
const FEATURED_CANDIDATES = 40;
const ROW_SIZE = 20;
/** Item types that make up a library's top level; seasons, episodes and tracks sit beneath them. */
const TOP_LEVEL_TYPES: MediaItemType[] = ["movie", "series", "album", "video"];
/** Episodes stay out of search so a show appears once, as its series. */
const SEARCH_TYPES: MediaItemType[] = TOP_LEVEL_TYPES;
const SEARCH_LIMIT = 60;

export interface SearchFilters {
	type?: string;
	genre?: string;
	yearFrom?: number;
	yearTo?: number;
	sort?: string;
	unwatched?: boolean;
}
const BROWSE_KINDS: Record<string, MediaItemType[]> = {
	movies: ["movie", "video"],
	tv: ["series"],
	music: ["album"],
};

interface StoredImage {
	type?: unknown;
	path?: unknown;
}

/** Index of the first downloaded image of one of the given types, preferring earlier types in the list. */
function imageIndex(images: unknown[] | null | undefined, types: string[]): number | null {
	const list = (images ?? []) as StoredImage[];
	for (const type of types) {
		const index = list.findIndex((image) => image?.type === type && typeof image.path === "string" && image.path.length > 0);
		if (index >= 0) {
			return index;
		}
	}
	return null;
}

function textOf(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value : null;
}

function stringsOf(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0) : [];
}

function runtimeOf(item: MediaItem): number | null {
	const minutes = Number(item.metadata?.runtime);
	if (Number.isFinite(minutes) && minutes > 0) {
		return Math.round(minutes);
	}
	const seconds = Number(item.technical?.duration);
	return Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds / 60) : null;
}

/** Names, roles and whether a photo is available; the photo URL itself is never exposed. */
function peopleOf(value: unknown): Array<{ id: string; name: string; role: string | null; hasImage: boolean }> {
	if (!Array.isArray(value)) {
		return [];
	}
	return value
		.map((person) => person as { name?: unknown; role?: unknown; image?: unknown })
		.filter((person) => typeof person?.name === "string" && person.name.trim().length > 0)
		.slice(0, 20)
		.map((person) => ({ id: personIdOf(person.name as string), name: person.name as string, role: textOf(person.role), hasImage: allowedPersonImage(person.image) !== null }));
}

/** Crew with their department (director, writer, ...), one entry per person and department. */
function crewOf(value: unknown): Array<{ id: string; name: string; role: string; hasImage: boolean }> {
	if (!Array.isArray(value)) {
		return [];
	}
	const seen = new Set<string>();
	const crew: Array<{ id: string; name: string; role: string; hasImage: boolean }> = [];
	for (const entry of value) {
		const person = entry as { name?: unknown; type?: unknown; image?: unknown } | null;
		if (typeof person?.name !== "string" || !person.name.trim()) {
			continue;
		}
		const role = typeof person.type === "string" && person.type.trim() ? person.type.trim().toLowerCase() : "crew";
		if (!seen.has(`${person.name}|${role}`)) {
			seen.add(`${person.name}|${role}`);
			crew.push({ id: personIdOf(person.name), name: person.name.trim(), role, hasImage: allowedPersonImage(person.image) !== null });
		}
	}
	return crew.slice(0, 30);
}

export interface HomeCard {
	id: string;
	type: MediaItemType;
	title: string;
	year: number | null;
	/** Image indexes to request from /media/items/:id/images/:index, or null when none has been downloaded. */
	poster: number | null;
	backdrop: number | null;
	updatedAt: Date;
}

export interface HomeFeatured extends HomeCard {
	tagline: string | null;
	overview: string | null;
	rating: string | null;
	runtimeMinutes: number | null;
}

export interface HomeLibrary {
	id: string;
	name: string;
	type: string;
	itemCount: number;
	/** A representative item whose artwork is shown for the library. */
	cover: { itemId: string; index: number; updatedAt: Date } | null;
}

export interface ContinueCard {
	id: string;
	type: MediaItemType;
	title: string;
	subtitle: string | null;
	/** The item whose image to show; episodes fall back to their series' artwork. */
	imageItemId: string;
	imageIndex: number | null;
	imageUpdatedAt: Date;
	positionSeconds: number;
	progress: number;
	updatedAt: Date;
}

/** At or beyond this fraction of the runtime an item counts as finished. */
const COMPLETED_FRACTION = 0.92;
/** Watching less than this isn't worth resuming. */
const MIN_RESUME_SECONDS = 20;
const CONTINUE_TYPES: MediaItemType[] = ["movie", "episode", "video"];
const CONTINUE_LIMIT = 20;

/** The content shown on the signed-in home page. */
@Injectable()
export class MediaHomeService {

	constructor(
		@Inject(DefaultDataSource) private readonly dataSource: DataSource,
		@Inject(IndexerClient) private readonly indexer: IndexerClient,
	) {}

	private readonly profileLookups = new Map<string, Promise<PersonProfile | null>>();

	async home(userId: string) {
		const [libraries, movies, shows, albums, candidates, continueWatching] = await Promise.all([
			this.libraries(),
			this.latest(["movie"], ROW_SIZE, userId),
			this.latest(["series"], ROW_SIZE, userId),
			this.latest(["album"], ROW_SIZE),
			this.latest(["movie", "series"], FEATURED_CANDIDATES, userId),
			this.continueWatching(userId),
		]);

		const featured = candidates
			.filter((item) => item.backdrop !== null)
			.slice(0, FEATURED_COUNT)
			.map(({ raw, ...card }) => ({ ...card, ...raw }));

		return {
			libraries,
			featured,
			continueWatching,
			recentMovies: movies.map(({ raw: _raw, ...card }) => card),
			recentShows: shows.map(({ raw: _raw, ...card }) => card),
			recentAlbums: albums.map(({ raw: _raw, ...card }) => card),
		};
	}

	async getProgress(userId: string, itemId: string) {
		const row = await this.dataSource.getRepository(WatchProgress).findOneBy({ userId, itemId });
		return { positionSeconds: row && !row.completed ? row.positionSeconds : 0, completed: row?.completed ?? false };
	}

	/** Records a position; finishing an item marks it completed so it leaves "Continue watching". */
	async saveProgress(userId: string, itemId: string, positionSeconds: number, durationSeconds: number) {
		const item = await this.dataSource.getRepository(MediaItem).findOne({ where: { id: itemId }, select: { id: true, type: true } });
		if (!item || !CONTINUE_TYPES.includes(item.type)) {
			throw new NotFound("Media item not found.");
		}
		const repo = this.dataSource.getRepository(WatchProgress);
		const completed = durationSeconds > 0 && positionSeconds >= durationSeconds * COMPLETED_FRACTION;
		if (!completed && positionSeconds < MIN_RESUME_SECONDS) {
			const existing = await repo.findOneBy({ userId, itemId });
			if (!existing) {
				return;
			}
		}
		await repo.upsert({ userId, itemId, positionSeconds: completed ? 0 : positionSeconds, durationSeconds, completed, updatedAt: new Date() }, ["userId", "itemId"]);
	}

	/** Marks an item watched or unwatched; a series or season applies to every episode beneath it. */
	async setWatched(userId: string, itemId: string, watched: boolean) {
		const repo = this.dataSource.getRepository(MediaItem);
		const item = await repo.findOne({ where: { id: itemId, isPlaceholder: false }, select: { id: true, type: true } });
		if (!item) {
			throw new NotFound("Media item not found.");
		}
		let ids: string[];
		if (CONTINUE_TYPES.includes(item.type)) {
			ids = [item.id];
		} else if (item.type === "season" || item.type === "series") {
			ids = await this.episodeIds(item.id, item.type);
		} else {
			throw new NotFound("Media item not found.");
		}
		if (ids.length === 0) {
			return;
		}
		const progress = this.dataSource.getRepository(WatchProgress);
		if (watched) {
			await progress.upsert(
				ids.map((id) => ({ userId, itemId: id, positionSeconds: 0, completed: true, updatedAt: new Date() })),
				["userId", "itemId"],
			);
		} else {
			await progress.delete({ userId, itemId: In(ids) });
		}
	}

	private async episodeIds(id: string, type: "season" | "series"): Promise<string[]> {
		const rows: Array<{ id: string }> = await this.dataSource.query(
			type === "season"
				? `SELECT id FROM media_items WHERE parent_id = $1 AND type = 'episode' AND is_placeholder = false`
				: `SELECT e.id FROM media_items e JOIN media_items s ON e.parent_id = s.id WHERE s.parent_id = $1 AND e.type = 'episode' AND e.is_placeholder = false`,
			[id],
		);
		return rows.map((row) => row.id);
	}

	/** Unfinished movies, episodes and videos the user has started, most recent first. */
	private async continueWatching(userId: string): Promise<ContinueCard[]> {
		const rows = await this.dataSource.getRepository(WatchProgress).find({ where: { userId, completed: false }, order: { updatedAt: "DESC" }, take: CONTINUE_LIMIT * 2 });
		if (rows.length === 0) {
			return [];
		}
		const repo = this.dataSource.getRepository(MediaItem);
		const items = await repo.find({ where: { id: In(rows.map((row) => row.itemId)), isPlaceholder: false } });
		const byId = new Map(items.map((item) => [item.id, item]));
		const seasonIds = [...new Set(items.filter((item) => item.type === "episode" && item.parentId).map((item) => item.parentId as string))];
		const seasons = seasonIds.length > 0 ? await repo.findBy({ id: In(seasonIds) }) : [];
		const seasonById = new Map(seasons.map((season) => [season.id, season]));
		const seriesIds = [...new Set(seasons.filter((season) => season.parentId).map((season) => season.parentId as string))];
		const seriesList = seriesIds.length > 0 ? await repo.findBy({ id: In(seriesIds) }) : [];
		const seriesById = new Map(seriesList.map((series) => [series.id, series]));

		const cards: ContinueCard[] = [];
		for (const row of rows) {
			const item = byId.get(row.itemId);
			if (!item || !CONTINUE_TYPES.includes(item.type)) {
				continue;
			}
			const season = item.parentId ? seasonById.get(item.parentId) : undefined;
			const series = season?.parentId ? seriesById.get(season.parentId) : undefined;
			let title = item.title;
			let subtitle: string | null = item.year ? String(item.year) : null;
			if (item.type === "episode" && series) {
				const code = season?.seasonNumber != null && item.episodeNumber != null ? `S${season.seasonNumber}E${item.episodeNumber}` : null;
				title = series.title;
				subtitle = [code, item.title].filter(Boolean).join(" · ");
			}
			let imageSource = item;
			let index = imageIndex(item.images, ["backdrop", "thumb", "poster"]);
			if (index === null && series) {
				index = imageIndex(series.images, ["backdrop", "thumb", "poster"]);
				imageSource = series;
			}
			const duration = row.durationSeconds > 0 ? row.durationSeconds : (runtimeOf(item) ?? 0) * 60;
			cards.push({
				id: item.id,
				type: item.type,
				title,
				subtitle,
				imageItemId: imageSource.id,
				imageIndex: index,
				imageUpdatedAt: imageSource.updatedAt,
				positionSeconds: row.positionSeconds,
				progress: duration > 0 ? Math.min(99, Math.max(1, Math.round((row.positionSeconds / duration) * 100))) : 0,
				updatedAt: row.updatedAt,
			});
			if (cards.length >= CONTINUE_LIMIT) {
				break;
			}
		}
		return cards;
	}

	/** One item for the detail page, with its seasons and episodes (or tracks) beneath it. */
	async detail(id: string, userId?: string) {
		const repo = this.dataSource.getRepository(MediaItem);
		const item = await repo.findOneBy({ id });
		if (!item || item.isPlaceholder) {
			throw new NotFound("Media item not found.");
		}
		const parent = item.parentId ? await repo.findOneBy({ id: item.parentId }) : null;
		const series = parent?.parentId && parent.type === "season" ? await repo.findOneBy({ id: parent.parentId }) : null;

		const children = await repo
			.createQueryBuilder("child")
			.where("child.parent_id = :id", { id })
			.andWhere("child.is_placeholder = false")
			.orderBy("child.season_number", "ASC", "NULLS LAST")
			.addOrderBy("child.episode_number", "ASC", "NULLS LAST")
			.addOrderBy("COALESCE(child.sort_title, child.title)", "ASC")
			.getMany();

		// A show lists its episodes under each season so the page can show everything at once.
		const grandchildren =
			item.type === "series" && children.length > 0
				? await repo
						.createQueryBuilder("episode")
						.where("episode.parent_id IN (:...ids)", { ids: children.map((child) => child.id) })
						.andWhere("episode.is_placeholder = false")
						.orderBy("episode.episode_number", "ASC", "NULLS LAST")
						.getMany()
				: [];

		const episodeIds = [...grandchildren, ...children, item].filter((entry) => entry.type === "episode" || entry.type === "movie" || entry.type === "video").map((entry) => entry.id);
		const watchedIds = new Set(
			userId && episodeIds.length > 0 ? (await this.dataSource.getRepository(WatchProgress).find({ where: { userId, itemId: In(episodeIds), completed: true }, select: { itemId: true } })).map((row) => row.itemId) : [],
		);

		const summarize = (entry: MediaItem) => ({
			id: entry.id,
			watched: watchedIds.has(entry.id),
			type: entry.type,
			title: entry.title,
			year: entry.year,
			seasonNumber: entry.seasonNumber,
			episodeNumber: entry.episodeNumber,
			overview: textOf(entry.metadata?.overview),
			runtimeMinutes: runtimeOf(entry),
			poster: imageIndex(entry.images, ["poster"]),
			thumb: imageIndex(entry.images, ["thumb", "backdrop", "poster"]),
			updatedAt: entry.updatedAt,
		});

		const metadata = item.metadata ?? {};
		return {
			id: item.id,
			watched: watchedIds.has(item.id),
			type: item.type,
			title: item.title,
			year: item.year,
			seasonNumber: item.seasonNumber,
			episodeNumber: item.episodeNumber,
			tagline: textOf(metadata.tagline),
			overview: textOf(metadata.overview),
			rating: textOf(metadata.contentRating),
			runtimeMinutes: runtimeOf(item),
			genres: stringsOf(metadata.genres),
			studios: stringsOf(metadata.studios),
			cast: peopleOf(metadata.cast),
			crew: crewOf(metadata.crew),
			ratings: (metadata.ratings && typeof metadata.ratings === "object" ? metadata.ratings : {}) as Record<string, number>,
			status: textOf(metadata.status),
			artist: textOf(metadata.artist ?? metadata.albumArtist),
			artistId: (() => {
				const artist = textOf(metadata.artist ?? metadata.albumArtist);
				return artist ? personIdOf(artist) : null;
			})(),
			technical: item.technical
				? {
						container: textOf(item.technical.container),
						videoCodec: textOf(item.technical.videoCodec),
						audioCodec: textOf(item.technical.audioCodec),
						width: typeof item.technical.width === "number" ? item.technical.width : null,
						height: typeof item.technical.height === "number" ? item.technical.height : null,
						hdr: textOf(item.technical.hdr),
					}
				: null,
			chapters: parseChapters(item.technical),
			poster: imageIndex(item.images, ["poster"]),
			backdrop: imageIndex(item.images, ["backdrop", "thumb"]),
			logo: imageIndex(item.images, ["logo"]),
			updatedAt: item.updatedAt,
			parent: parent ? { id: parent.id, type: parent.type, title: parent.title } : null,
			series: series ? { id: series.id, title: series.title } : null,
			children: children.map((child) => ({
				...summarize(child),
				episodes: grandchildren.filter((episode) => episode.parentId === child.id).map(summarize),
			})),
		};
	}

	/** Every genre present in the library, for the search filter. */
	async genres(): Promise<string[]> {
		const rows: Array<{ genre: string }> = await this.dataSource.query(
			`SELECT DISTINCT g AS genre FROM media_items, jsonb_array_elements_text(CASE WHEN jsonb_typeof(metadata -> 'genres') = 'array' THEN metadata -> 'genres' ELSE '[]'::jsonb END) g WHERE is_placeholder = false ORDER BY g`,
		);
		return rows.map((row) => row.genre).filter(Boolean);
	}

	/** Search over everything playable or browsable. Matches titles first, then cast and crew; every filter is optional. */
	async search(userId: string, query: string, filters: SearchFilters = {}): Promise<HomeCard[]> {
		const term = query.trim().slice(0, 100);
		const genre = filters.genre?.trim().slice(0, 60) || undefined;
		const hasFilter = Boolean(filters.type || genre || filters.yearFrom || filters.yearTo || filters.unwatched);
		if (term.length < 2 && !(term.length === 0 && hasFilter)) {
			return [];
		}
		const types = filters.type && SEARCH_TYPES.includes(filters.type as MediaItemType) ? [filters.type as MediaItemType] : SEARCH_TYPES;
		const query_ = this.dataSource
			.getRepository(MediaItem)
			.createQueryBuilder("item")
			.select(["item.id", "item.type", "item.title", "item.year", "item.images", "item.updatedAt"])
			.where("item.is_placeholder = false")
			.andWhere("item.type IN (:...types)", { types });

		if (term) {
			const escaped = term.replace(/[\\%_]/g, (character) => `\\${character}`);
			query_
				.andWhere("(item.title ILIKE :contains OR item.sort_title ILIKE :contains OR (item.metadata -> 'cast')::text ILIKE :contains OR (item.metadata -> 'crew')::text ILIKE :contains)", { contains: `%${escaped}%` })
				.setParameter("prefix", `${escaped}%`);
		}
		if (genre) {
			query_.andWhere("EXISTS (SELECT 1 FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(item.metadata -> 'genres') = 'array' THEN item.metadata -> 'genres' ELSE '[]'::jsonb END) g WHERE lower(g) = lower(:genre))", { genre });
		}
		if (Number.isInteger(filters.yearFrom)) {
			query_.andWhere("item.year >= :yearFrom", { yearFrom: filters.yearFrom });
		}
		if (Number.isInteger(filters.yearTo)) {
			query_.andWhere("item.year <= :yearTo", { yearTo: filters.yearTo });
		}
		if (filters.unwatched) {
			query_.andWhere("NOT EXISTS (SELECT 1 FROM watch_progress w WHERE w.user_id = :userId AND w.item_id = item.id AND w.completed = true)", { userId });
		}

		switch (filters.sort) {
			case "title":
				query_.orderBy("COALESCE(item.sort_title, item.title)", "ASC");
				break;
			case "year":
				query_.orderBy("item.year", "DESC", "NULLS LAST").addOrderBy("item.title", "ASC");
				break;
			case "added":
				query_.orderBy("item.created_at", "DESC");
				break;
			default:
				if (term) {
					query_.orderBy("CASE WHEN item.title ILIKE :prefix THEN 0 WHEN item.title ILIKE :contains THEN 1 ELSE 2 END", "ASC").addOrderBy("item.title", "ASC");
				} else {
					query_.orderBy("item.title", "ASC");
				}
		}
		const items = await query_.limit(SEARCH_LIMIT).getMany();

		return items.map((item) => ({
			id: item.id,
			type: item.type,
			title: item.title,
			year: item.year,
			poster: imageIndex(item.images, ["poster"]),
			backdrop: imageIndex(item.images, ["backdrop", "thumb"]),
			updatedAt: item.updatedAt,
		}));
	}

	/** A paged, sorted listing of one section (movies, tv or music). */
	async browse(kind: string, sort: string, offset: number, limit: number) {
		const types = BROWSE_KINDS[kind];
		if (!types) {
			throw new NotFound("Unknown section.");
		}
		const query = this.dataSource
			.getRepository(MediaItem)
			.createQueryBuilder("item")
			.select(["item.id", "item.type", "item.title", "item.year", "item.images", "item.updatedAt"])
			.where("item.is_placeholder = false")
			.andWhere("item.type IN (:...types)", { types });
		if (sort === "title") {
			query.orderBy("COALESCE(item.sort_title, item.title)", "ASC");
		} else if (sort === "year") {
			query.orderBy("item.year", "DESC", "NULLS LAST").addOrderBy("item.title", "ASC");
		} else {
			query.orderBy("item.created_at", "DESC").addOrderBy("item.title", "ASC");
		}
		const [items, total] = await query.skip(offset).take(limit).getManyAndCount();
		return { total, items: items.map((item) => this.toCard(item)) };
	}

	/** Everything a person is credited on (albums, movies, shows), grouped by role, matched by name ignoring case. */
	async person(id: string): Promise<{ id: string; name: string; hasImage: boolean; profile: PersonProfileView | null; groups: Array<{ role: string; items: Array<HomeCard & { detail: string | null }> }> }> {
		if (!UUID_PATTERN.test(id)) {
			throw new NotFound("Person not found.");
		}
		const credits = await this.dataSource
			.getRepository(MediaCredit)
			.createQueryBuilder("credit")
			.innerJoinAndMapOne("credit.item", MediaItem, "item", "item.id = credit.item_id AND item.is_placeholder = false")
			.where("credit.person_id = :id", { id: id.toLowerCase() })
			.orderBy("item.year", "DESC", "NULLS LAST")
			.addOrderBy("COALESCE(item.sort_title, item.title)", "ASC")
			.getMany();
		if (credits.length === 0) {
			throw new NotFound("Person not found.");
		}
		const groups = new Map<string, Map<string, HomeCard & { detail: string | null }>>();
		for (const credit of credits) {
			const item = (credit as MediaCredit & { item: MediaItem }).item;
			const role = credit.role === "albumArtist" ? "artist" : credit.role;
			const cards = groups.get(role) ?? new Map<string, HomeCard & { detail: string | null }>();
			cards.set(item.id, { ...this.toCard(item), detail: credit.detail || null });
			groups.set(role, cards);
		}
		const rank = (role: string) => {
			const index = ROLE_ORDER.indexOf(role);
			return index === -1 ? ROLE_ORDER.length : index;
		};
		const kind = groups.has("artist") ? "artist" : "film";
		const stored = await this.profileOf(credits[0].personId, credits[0].name, kind);
		return {
			id: credits[0].personId,
			name: credits[0].name,
			hasImage: credits.some((credit) => allowedPersonImage(credit.image) !== null) || allowedPersonImage(stored?.image) !== null,
			profile: stored ? toProfileView(stored) : null,
			groups: [...groups.entries()].sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b)).map(([role, cards]) => ({ role, items: [...cards.values()] })),
		};
	}

	/** The stored profile, fetched through the indexer the first time a person is viewed. Misses are retried after two weeks. */
	private profileOf(personId: string, name: string, kind: string): Promise<PersonProfile | null> {
		const pending = this.profileLookups.get(personId);
		if (pending) {
			return pending;
		}
		const lookup = this.loadProfile(personId, name, kind).finally(() => this.profileLookups.delete(personId));
		this.profileLookups.set(personId, lookup);
		return lookup;
	}

	private async loadProfile(personId: string, name: string, kind: string): Promise<PersonProfile | null> {
		const repository = this.dataSource.getRepository(PersonProfile);
		const stored = await repository.findOneBy({ personId });
		const age = stored ? Date.now() - stored.fetchedAt.getTime() : Infinity;
		if (!stored || age > (stored.biography ? PROFILE_REFRESH_MS : PROFILE_RETRY_MS)) {
			try {
				const bio = await this.indexer.fetchPersonBio(name, kind);
				const row = repository.create({
					personId,
					description: bio?.description || null,
					biography: bio?.biography || null,
					source: bio?.source || null,
					sourceUrl: bio?.url && PROFILE_LINK_PREFIXES.some((prefix) => bio.url.startsWith(prefix)) ? bio.url : null,
					image: allowedPersonImage(bio?.imageUrl),
					fetchedAt: new Date(),
				});
				await repository.save(row);
				return row;
			} catch {
				// The indexer or Wikipedia is unavailable; keep any older copy and try again on the next view.
			}
		}
		return stored;
	}

	/** A person's photo, taken from the first credit that has one, scaled to the requested width. */
	async personImage(id: string, width?: number): Promise<{ data: Buffer; mime: string }> {
		if (!UUID_PATTERN.test(id)) {
			throw new NotFound("Image not found.");
		}
		const credits = await this.dataSource
			.getRepository(MediaCredit)
			.createQueryBuilder("credit")
			.where("credit.person_id = :id AND credit.image IS NOT NULL", { id: id.toLowerCase() })
			.orderBy("credit.position", "ASC")
			.limit(10)
			.getMany();
		let url = credits.map((credit) => allowedPersonImage(credit.image)).find((value): value is string => value !== null);
		if (!url) {
			const profile = await this.dataSource.getRepository(PersonProfile).findOneBy({ personId: id.toLowerCase() });
			url = allowedPersonImage(profile?.image) ?? undefined;
		}
		if (!url) {
			throw new NotFound("Image not found.");
		}
		return resizeImage(() => this.loadPersonPhoto(url), `person:${url}`, normalizeWidth(width));
	}

	/** Prefers the indexer's on-disk cache, and goes straight to the provider only when the indexer is unreachable. */
	private async loadPersonPhoto(url: string): Promise<{ data: Buffer; mime: string }> {
		try {
			return await this.indexer.fetchPersonImage(url);
		} catch (error) {
			if ((error as { status?: number }).status === 503) {
				return fetchPersonImage(url);
			}
			throw error;
		}
	}

	private toCard(item: MediaItem): HomeCard {
		return {
			id: item.id,
			type: item.type,
			title: item.title,
			year: item.year,
			poster: imageIndex(item.images, ["poster"]),
			backdrop: imageIndex(item.images, ["backdrop", "thumb"]),
			updatedAt: item.updatedAt,
		};
	}

	private async libraries(): Promise<HomeLibrary[]> {
		const libraries = await this.dataSource.getRepository(MediaLibrary).find({ order: { name: "ASC" } });
		if (libraries.length === 0) {
			return [];
		}

		const counts = await this.dataSource
			.getRepository(MediaItem)
			.createQueryBuilder("item")
			.select("item.library_id", "libraryId")
			.addSelect("COUNT(*)", "count")
			.where("item.is_placeholder = false")
			.andWhere("item.type IN (:...types)", { types: TOP_LEVEL_TYPES })
			.groupBy("item.library_id")
			.getRawMany<{ libraryId: string; count: string }>();
		const countByLibrary = new Map(counts.map((row) => [row.libraryId, Number(row.count)]));

		return Promise.all(
			libraries.map(async (library) => {
				const recent = await this.dataSource
					.getRepository(MediaItem)
					.createQueryBuilder("item")
					.select(["item.id", "item.images", "item.updatedAt"])
					.where("item.library_id = :libraryId", { libraryId: library.id })
					.andWhere("item.is_placeholder = false")
					.andWhere("item.type IN (:...types)", { types: TOP_LEVEL_TYPES })
					.orderBy("item.created_at", "DESC")
					.limit(12)
					.getMany();

				let cover: HomeLibrary["cover"] = null;
				for (const item of recent) {
					const index = imageIndex(item.images, ["backdrop", "thumb", "poster"]);
					if (index !== null) {
						cover = { itemId: item.id, index, updatedAt: item.updatedAt };
						break;
					}
				}
				return { id: library.id, name: library.name, type: library.type, itemCount: countByLibrary.get(library.id) ?? 0, cover };
			}),
		);
	}

	/** Newest items first; with a user, titles they have marked (or finished) watching are left out. */
	private async latest(types: MediaItemType[], limit: number, userId?: string) {
		const query = this.dataSource.getRepository(MediaItem).createQueryBuilder("item");
		if (userId) {
			query.andWhere(
				`NOT (
					(item.type IN ('movie', 'video') AND EXISTS (SELECT 1 FROM watch_progress w WHERE w.user_id = :userId AND w.item_id = item.id AND w.completed = true))
					OR (item.type = 'series'
						AND EXISTS (SELECT 1 FROM media_items s JOIN media_items e ON e.parent_id = s.id WHERE s.parent_id = item.id AND e.type = 'episode' AND e.is_placeholder = false)
						AND NOT EXISTS (SELECT 1 FROM media_items s JOIN media_items e ON e.parent_id = s.id
							WHERE s.parent_id = item.id AND e.type = 'episode' AND e.is_placeholder = false
							AND NOT EXISTS (SELECT 1 FROM watch_progress w WHERE w.user_id = :userId AND w.item_id = e.id AND w.completed = true)))
				)`,
				{ userId },
			);
		}
		const { entities, raw } = await query
			.select(["item.id", "item.type", "item.title", "item.year", "item.images", "item.updatedAt"])
			.addSelect("item.metadata ->> 'tagline'", "tagline")
			.addSelect("item.metadata ->> 'overview'", "overview")
			.addSelect("item.metadata ->> 'contentRating'", "rating")
			.addSelect("item.metadata ->> 'runtime'", "runtime")
			.andWhere("item.is_placeholder = false")
			.andWhere("item.type IN (:...types)", { types })
			.orderBy("item.created_at", "DESC")
			.limit(limit)
			.getRawAndEntities();

		return entities.map((item, index) => {
			const row = raw[index] as { tagline: string | null; overview: string | null; rating: string | null; runtime: string | null };
			const runtime = Number.parseInt(row.runtime ?? "", 10);
			const card: HomeCard = {
				id: item.id,
				type: item.type,
				title: item.title,
				year: item.year,
				poster: imageIndex(item.images, ["poster"]),
				backdrop: imageIndex(item.images, ["backdrop", "thumb"]),
				updatedAt: item.updatedAt,
			};
			return {
				...card,
				raw: {
					tagline: row.tagline || null,
					overview: row.overview || null,
					rating: row.rating || null,
					runtimeMinutes: Number.isFinite(runtime) && runtime > 0 ? runtime : null,
				},
			};
		});
	}
}
