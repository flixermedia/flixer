import { Inject, Injectable } from "@tsed/di";
import { NotFound } from "@tsed/exceptions";
import { DataSource, In } from "typeorm";
import { DefaultDataSource } from "../../datasources/defaultDataSource.datasource.js";
import { MediaItem, type MediaItemType } from "../../entities/mediaItem.entity.js";
import { MediaLibrary } from "../../entities/mediaLibrary.entity.js";
import { WatchProgress } from "../../entities/watchProgress.entity.js";

const FEATURED_COUNT = 5;
const FEATURED_CANDIDATES = 40;
const ROW_SIZE = 20;
/** Item types that make up a library's top level; seasons, episodes and tracks sit beneath them. */
const TOP_LEVEL_TYPES: MediaItemType[] = ["movie", "series", "album", "video"];
const SEARCH_TYPES: MediaItemType[] = [...TOP_LEVEL_TYPES, "episode"];
const SEARCH_LIMIT = 60;
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

/** Names and roles only; image paths on people are not exposed. */
function peopleOf(value: unknown): Array<{ name: string; role: string | null }> {
	if (!Array.isArray(value)) {
		return [];
	}
	return value
		.map((person) => person as { name?: unknown; role?: unknown })
		.filter((person) => typeof person?.name === "string" && person.name.length > 0)
		.slice(0, 20)
		.map((person) => ({ name: person.name as string, role: textOf(person.role) }));
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

	constructor(@Inject(DefaultDataSource) private readonly dataSource: DataSource) {}

	async home(userId: string) {
		const [libraries, movies, shows, albums, candidates, continueWatching] = await Promise.all([
			this.libraries(),
			this.latest(["movie"], ROW_SIZE),
			this.latest(["series"], ROW_SIZE),
			this.latest(["album"], ROW_SIZE),
			this.latest(["movie", "series"], FEATURED_CANDIDATES),
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
	async detail(id: string) {
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

		const summarize = (entry: MediaItem) => ({
			id: entry.id,
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
			ratings: (metadata.ratings && typeof metadata.ratings === "object" ? metadata.ratings : {}) as Record<string, number>,
			status: textOf(metadata.status),
			artist: textOf(metadata.artist ?? metadata.albumArtist),
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

	/** Title search over everything playable or browsable; prefix matches rank first. */
	async search(query: string, type?: string): Promise<HomeCard[]> {
		const term = query.trim().slice(0, 100);
		if (term.length < 2) {
			return [];
		}
		const escaped = term.replace(/[\\%_]/g, (character) => `\\${character}`);
		const types = type && SEARCH_TYPES.includes(type as MediaItemType) ? [type as MediaItemType] : SEARCH_TYPES;
		const items = await this.dataSource
			.getRepository(MediaItem)
			.createQueryBuilder("item")
			.select(["item.id", "item.type", "item.title", "item.year", "item.images", "item.updatedAt"])
			.where("item.is_placeholder = false")
			.andWhere("item.type IN (:...types)", { types })
			.andWhere("(item.title ILIKE :contains OR item.sort_title ILIKE :contains)", { contains: `%${escaped}%` })
			.orderBy("CASE WHEN item.title ILIKE :prefix THEN 0 ELSE 1 END", "ASC")
			.addOrderBy("item.title", "ASC")
			.setParameter("prefix", `${escaped}%`)
			.limit(SEARCH_LIMIT)
			.getMany();

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

	private async latest(types: MediaItemType[], limit: number) {
		const { entities, raw } = await this.dataSource
			.getRepository(MediaItem)
			.createQueryBuilder("item")
			.select(["item.id", "item.type", "item.title", "item.year", "item.images", "item.updatedAt"])
			.addSelect("item.metadata ->> 'tagline'", "tagline")
			.addSelect("item.metadata ->> 'overview'", "overview")
			.addSelect("item.metadata ->> 'contentRating'", "rating")
			.addSelect("item.metadata ->> 'runtime'", "runtime")
			.where("item.is_placeholder = false")
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
