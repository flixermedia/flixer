import { Inject, Injectable } from "@tsed/di";
import { BadRequest, NotFound } from "@tsed/exceptions";
import { DataSource } from "typeorm";
import { DefaultDataSource } from "../../datasources/defaultDataSource.datasource.js";
import { MEDIA_ITEM_TYPES, MediaItem, type MediaItemType } from "../../entities/mediaItem.entity.js";
import { IndexerClient } from "../indexer/indexerClient.js";
import { UpdateMediaItemRequest } from "./adminMediaRequests.js";
import { normalizeWidth, resizeImage } from "./mediaImageResizer.js";
import {
	deleteUpload,
	detectImageType,
	MANUAL_PROVIDER,
	MAX_MEDIA_IMAGE_BYTES,
	mimeForUpload,
	readUpload,
	saveUpload,
	UPLOAD_PREFIX,
	uploadFilename,
} from "./mediaImageStorage.js";

export const MEDIA_IMAGE_TYPES = ["poster", "backdrop", "logo", "banner", "thumb", "disc"] as const;
const MAX_IMAGES_PER_ITEM = 60;
const PROVIDER_ID_PATTERN = /^[a-z][a-z0-9_-]{0,31}$/;
const MAX_PROVIDER_ID_LENGTH = 256;

interface StoredImage {
	type?: unknown;
	path?: unknown;
	url?: unknown;
	provider?: unknown;
	width?: unknown;
	height?: unknown;
	language?: unknown;
}

export interface MediaItemImage {
	index: number;
	type: string;
	provider: string;
	width: number | null;
	height: number | null;
	language: string | null;
	/** Whether the file has been downloaded; remote candidates have not. */
	available: boolean;
	/** Uploaded by an admin, so it can be removed and survives rescans. */
	manual: boolean;
}

function providerIdField(provider: string): string {
	return `providerId:${provider}`;
}

function toImage(raw: unknown, index: number): MediaItemImage {

	const image = (raw ?? {}) as StoredImage;
	return {
		index,
		type: typeof image.type === "string" ? image.type : "poster",
		provider: typeof image.provider === "string" ? image.provider : "",
		width: typeof image.width === "number" ? image.width : null,
		height: typeof image.height === "number" ? image.height : null,
		language: typeof image.language === "string" && image.language ? image.language : null,
		available: typeof image.path === "string" && image.path.length > 0,
		manual: image.provider === MANUAL_PROVIDER && uploadFilename(image.path) !== null,
	};

}

function posterIndex(images: unknown[] | null | undefined): number | null {

	const list = (images ?? []).map(toImage);
	return list.find((image) => image.type === "poster" && image.available)?.index ?? null;

}

function manualPosterIndex(images: unknown[] | null | undefined): number | null {

	const list = (images ?? []).map(toImage);
	return list.find((image) => image.type === "poster" && image.available && image.manual)?.index ?? null;

}

function episodeArtworkIndex(images: unknown[] | null | undefined): number | null {

	const list = (images ?? []).map(toImage);
	return (
		list.find((image) => image.type === "poster" && image.available && image.manual)?.index ??
		list.find((image) => image.type === "poster" && image.available)?.index ??
		list.find((image) => image.type === "thumb" && image.available)?.index ??
		null
	);

}

export interface MediaItemQuery {
	libraryId?: string;
	type?: string;
	parentId?: string;
	search?: string;
	page?: number;
	size?: number;
}

const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 50;
const POPULAR_ITEMS_PER_SECTION = 13;
const MEDIA_CATEGORIES = {
	movies: ["movie", "video"],
	tvShows: ["series"],
	music: ["album"],
} as const satisfies Record<string, readonly MediaItemType[]>;
type MediaCategory = keyof typeof MEDIA_CATEGORIES;
type MediaCategoryCounts = Record<MediaCategory, number>;
type MediaItemListFields = Pick<
	MediaItem,
	| "id"
	| "libraryId"
	| "parentId"
	| "type"
	| "title"
	| "year"
	| "seasonNumber"
	| "episodeNumber"
	| "path"
	| "providerIds"
	| "sizeBytes"
	| "editedFields"
	| "images"
	| "updatedAt"
>;
/** Which request field maps to which item field, for tracking admin edits. */
const EDITABLE = ["title", "sortTitle", "year", "seasonNumber", "episodeNumber", "episodeEndNumber"] as const;

/** Browsing and correcting the items flixer-indexer has saved. */
@Injectable()
export class AdminMediaService {

	constructor(
		@Inject(DefaultDataSource) private readonly dataSource: DataSource,
		private readonly indexer: IndexerClient,
	) {}

	async list(query: MediaItemQuery) {
		const page = Math.max(1, Math.floor(query.page ?? 1));
		const size = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(query.size ?? DEFAULT_PAGE_SIZE)));
		const search = query.search?.trim();
		if (!query.libraryId && !query.type && !query.parentId && !search) {
			return this.popularOverview();
		}

		const builder = this.dataSource
			.getRepository(MediaItem)
			.createQueryBuilder("item")
			.leftJoin("media_items", "parent", "parent.id = item.parent_id")
			.addSelect("parent.title", "parentTitle")
			.where("item.is_placeholder = false");

		if (query.libraryId) {
			builder.andWhere("item.library_id = :libraryId", { libraryId: query.libraryId });
		}
		if (query.type) {
			if (Object.hasOwn(MEDIA_CATEGORIES, query.type)) {
				builder.andWhere("item.type IN (:...types)", { types: MEDIA_CATEGORIES[query.type as MediaCategory] });
			} else if ((MEDIA_ITEM_TYPES as readonly string[]).includes(query.type)) {
				builder.andWhere("item.type = :type", { type: query.type });
			} else {
				throw new BadRequest(`type must be one of ${MEDIA_ITEM_TYPES.join(", ")}.`);
			}
		}
		if (query.parentId) {
			builder.andWhere("item.parent_id = :parentId", { parentId: query.parentId });
		}
		// Browsing a whole library shows top-level items; children are browsed through their parent.
		if (!query.parentId && !query.type && !search) {
			builder.andWhere("item.parent_id IS NULL");
		}
		if (search) {
			const escaped = search.replace(/[\\%_]/g, "\\$&");
			builder.andWhere("(item.title ILIKE :search OR item.path ILIKE :search)", { search: `%${escaped}%` });
		}

		const total = await builder.getCount();
		const { entities, raw } = await builder
			.orderBy("COALESCE(item.sort_title, item.title)", "ASC")
			.addOrderBy("item.season_number", "ASC", "NULLS LAST")
			.addOrderBy("item.episode_number", "ASC", "NULLS LAST")
			.offset((page - 1) * size)
			.limit(size)
			.getRawAndEntities();

		const items = entities.map((item, index) => ({
			...this.toListItem(item),
			parentTitle: (raw[index]?.parentTitle as string | null) ?? null,
		}));
		const categoryCounts = search
			? await this.searchCategoryCounts(query, search)
			: await this.globalCategoryCounts();
		return { items, total, page, size, categoryCounts };
	}

	private async globalCategoryCounts(): Promise<MediaCategoryCounts> {
		const counts = Object.fromEntries(
			Object.keys(MEDIA_CATEGORIES).map((category) => [category, 0]),
		) as MediaCategoryCounts;
		const rows = await this.dataSource.query<Array<{ category: MediaCategory; count: string | number }>>(`
			SELECT CASE
				WHEN type IN ('movie', 'video') THEN 'movies'
				WHEN type = 'series' THEN 'tvShows'
				ELSE 'music'
			END AS category, COUNT(*)::int AS count
			FROM media_items
			WHERE is_placeholder = false AND parent_id IS NULL
				AND type IN ('movie', 'video', 'series', 'album')
			GROUP BY category
		`);
		for (const row of rows) counts[row.category] = Number(row.count);
		return counts;
	}

	private async searchCategoryCounts(query: MediaItemQuery, search: string): Promise<MediaCategoryCounts> {
		const builder = this.dataSource
			.getRepository(MediaItem)
			.createQueryBuilder("item")
			.select(
				"CASE WHEN item.type IN ('movie', 'video') THEN 'movies' WHEN item.type IN ('series', 'season', 'episode') THEN 'tvShows' ELSE 'music' END",
				"category",
			)
			.addSelect("COUNT(*)", "count")
			.where("item.is_placeholder = false");
		if (query.libraryId) builder.andWhere("item.library_id = :libraryId", { libraryId: query.libraryId });
		if (query.type) {
			if (Object.hasOwn(MEDIA_CATEGORIES, query.type)) {
				builder.andWhere("item.type IN (:...types)", { types: MEDIA_CATEGORIES[query.type as MediaCategory] });
			} else {
				builder.andWhere("item.type = :type", { type: query.type });
			}
		}
		if (query.parentId) builder.andWhere("item.parent_id = :parentId", { parentId: query.parentId });
		const escaped = search.replace(/[\\%_]/g, "\\$&");
		builder.andWhere("(item.title ILIKE :search OR item.path ILIKE :search)", { search: `%${escaped}%` });

		const counts = Object.fromEntries(
			Object.keys(MEDIA_CATEGORIES).map((category) => [category, 0]),
		) as MediaCategoryCounts;
		const rows = await builder.groupBy("category").getRawMany<{ category: MediaCategory; count: string }>();
		for (const row of rows) counts[row.category] = Number(row.count);
		return counts;
	}

	private async popularOverview() {
		const rows = await this.dataSource.query<
			Array<{
				id: string;
				libraryId: string;
				parentId: string | null;
				type: MediaItemType;
				title: string;
				year: number | null;
				seasonNumber: number | null;
				episodeNumber: number | null;
				path: string;
				providerIds: Record<string, string>;
				sizeBytes: string | number | null;
				editedFields: string[];
				images: unknown[];
				updatedAt: Date;
				parentTitle: string | null;
				total: string | number;
				section: MediaCategory;
				sectionTotal: string | number;
			}>
		>(
			`
			WITH watcher_counts AS (
				SELECT item_id, COUNT(*) AS watcher_count
				FROM watch_progress
				GROUP BY item_id
			),
			candidates AS (
				SELECT
					item.id,
					CASE WHEN item.type IN ('movie', 'video') THEN 'movies'
						WHEN item.type = 'series' THEN 'tvShows'
						ELSE 'music'
					END AS section,
					COALESCE(watcher_counts.watcher_count, 0) AS watcher_count,
					COALESCE(item.sort_title, item.title) AS sort_title
				FROM media_items item
				LEFT JOIN watcher_counts ON watcher_counts.item_id = item.id
				WHERE item.is_placeholder = false
					AND item.parent_id IS NULL
					AND item.type IN ('movie', 'video', 'series', 'album')
			),
			ranked_items AS (
				SELECT
					id,
					section,
					ROW_NUMBER() OVER (
						PARTITION BY section
						ORDER BY watcher_count DESC, sort_title ASC, id ASC
					) AS section_rank,
					COUNT(*) OVER (PARTITION BY section) AS section_total,
					COUNT(*) OVER () AS total
				FROM candidates
			)
			SELECT
				item.id,
				item.library_id AS "libraryId",
				item.parent_id AS "parentId",
				item.type,
				item.title,
				item.year,
				item.season_number AS "seasonNumber",
				item.episode_number AS "episodeNumber",
				item.path,
				item.provider_ids AS "providerIds",
				item.size_bytes AS "sizeBytes",
				item.edited_fields AS "editedFields",
				item.images,
				item.updated_at AS "updatedAt",
				parent.title AS "parentTitle",
				ranked_items.total,
				ranked_items.section,
				ranked_items.section_total AS "sectionTotal"
			FROM ranked_items
			JOIN media_items item ON item.id = ranked_items.id
			LEFT JOIN media_items parent ON parent.id = item.parent_id
			WHERE ranked_items.section_rank <= $1
			ORDER BY ranked_items.section, ranked_items.section_rank
		`,
			[POPULAR_ITEMS_PER_SECTION],
		);

		const categoryCounts: MediaCategoryCounts = { movies: 0, tvShows: 0, music: 0 };
		for (const row of rows) categoryCounts[row.section] = Number(row.sectionTotal);
		return {
			items: rows.map((row) => ({
				...this.toListItem({
					...row,
					sizeBytes: row.sizeBytes === null ? null : Number(row.sizeBytes),
				}),
				parentTitle: row.parentTitle,
			})),
			total: Number(rows[0]?.total ?? 0),
			page: 1,
			size: POPULAR_ITEMS_PER_SECTION,
			categoryCounts,
		};
	}

	async get(id: string) {
		const item = await this.find(id);
		const parent = item.parentId
			? await this.dataSource.getRepository(MediaItem).findOneBy({ id: item.parentId })
			: null;
		const childCount = await this.dataSource.getRepository(MediaItem).countBy({ parentId: item.id });
		const { images, ...rest } = item;
		return {
			...rest,
			images: (images ?? []).map(toImage),
			parent: parent ? { id: parent.id, title: parent.title, type: parent.type } : null,
			childCount,
		};
	}

	/** The bytes of one of an item's images, read from flixer's own storage or fetched from the indexer. A width scales it down. */
	async image(id: string, index: number, width?: number): Promise<{ data: Buffer; mime: string }> {
		const item = await this.find(id);
		const stored = (item.images ?? [])[index] as StoredImage | undefined;
		if (!stored || typeof stored.path !== "string" || !stored.path) {
			throw new NotFound("Image not found.");
		}
		const path = stored.path;
		return resizeImage(() => this.readImage(path), `${id}:${index}:${path}`, normalizeWidth(width));
	}

	private async readImage(path: string): Promise<{ data: Buffer; mime: string }> {
		const upload = uploadFilename(path);
		if (upload) {
			const data = await readUpload(upload);
			const mime = mimeForUpload(upload);
			if (!data || !mime) {
				throw new NotFound("Image not found.");
			}
			return { data, mime };
		}
		const { data, contentType } = await this.indexer.fetchImage(path);
		return { data, mime: contentType };
	}

	async addImage(id: string, type: string, buffer: Buffer | undefined) {
		if (!(MEDIA_IMAGE_TYPES as readonly string[]).includes(type)) {
			throw new BadRequest(`type must be one of ${MEDIA_IMAGE_TYPES.join(", ")}.`);
		}
		if (!buffer || buffer.length === 0) {
			throw new BadRequest("Choose an image file.");
		}
		if (buffer.length > MAX_MEDIA_IMAGE_BYTES) {
			throw new BadRequest("The image is too large.");
		}
		const detected = detectImageType(buffer);
		if (!detected) {
			throw new BadRequest("The file must be a PNG, JPEG, WebP or GIF image.");
		}
		const repository = this.dataSource.getRepository(MediaItem);
		const item = await this.find(id);
		if ((item.images ?? []).length >= MAX_IMAGES_PER_ITEM) {
			throw new BadRequest("This item has too many images.");
		}
		if (!item.rootId || !item.relativePath) {
			throw new BadRequest("This item has no stable library path for image storage.");
		}
		const filename = await saveUpload(item.rootId, item.relativePath, item.id, buffer, detected);
		item.images = [
			...(item.images ?? []),
			{ type, path: `${UPLOAD_PREFIX}${filename}`, provider: MANUAL_PROVIDER },
		];
		await repository.save(item);
		return this.get(id);
	}

	async removeImage(id: string, index: number) {
		const repository = this.dataSource.getRepository(MediaItem);
		const item = await this.find(id);
		const images = [...(item.images ?? [])];
		const filename = uploadFilename((images[index] as StoredImage | undefined)?.path);
		if (!filename) {
			throw new BadRequest("Only images you added can be removed.");
		}
		images.splice(index, 1);
		item.images = images;
		await repository.save(item);
		await deleteUpload(filename);
		return this.get(id);
	}

	async update(id: string, request: UpdateMediaItemRequest) {
		const repository = this.dataSource.getRepository(MediaItem);
		const item = await this.find(id);
		const edited = new Set(item.editedFields ?? []);

		if (request.title !== undefined) {
			if (request.title.trim().length === 0) {
				throw new BadRequest("The title cannot be empty.");
			}
			request.title = request.title.trim();
		}
		for (const field of EDITABLE) {
			const value = request[field];
			if (value !== undefined) {
				(item as unknown as Record<string, unknown>)[field] =
					typeof value === "string" && field === "sortTitle" && value.trim() === "" ? null : value;
				edited.add(field);
			}
		}
		if (request.overview !== undefined) {
			const { overview: _previous, ...rest } = item.metadata ?? {};
			item.metadata =
				request.overview === null || request.overview.trim() === ""
					? rest
					: { ...rest, overview: request.overview };
			edited.add("overview");
		}
		if (request.providerIds !== undefined) {
			if (
				typeof request.providerIds !== "object" ||
				request.providerIds === null ||
				Array.isArray(request.providerIds)
			) {
				throw new BadRequest("providerIds must be an object of provider names and text IDs.");
			}
			item.providerIds = { ...(item.providerIds ?? {}) };
			for (const [rawProvider, rawValue] of Object.entries(request.providerIds)) {
				const provider = rawProvider.trim().toLowerCase();
				if (!PROVIDER_ID_PATTERN.test(provider)) {
					throw new BadRequest(`"${rawProvider}" is not a valid provider name.`);
				}
				if (rawValue !== null && (typeof rawValue !== "string" || rawValue.length > MAX_PROVIDER_ID_LENGTH)) {
					throw new BadRequest(
						`The "${provider}" ID must be text up to ${MAX_PROVIDER_ID_LENGTH} characters, or null.`,
					);
				}
				const value = typeof rawValue === "string" ? rawValue.trim() : "";
				if (value) {
					item.providerIds[provider] = value;
					edited.add(providerIdField(provider));
				} else {
					delete item.providerIds[provider];
					edited.delete(providerIdField(provider));
				}
			}
		}

		item.editedFields = [...edited];
		await repository.save(item);
		return this.get(id);
	}

	/** Queues a forced re-index of the item; a series, season or album also re-indexes everything beneath it. */
	async refresh(id: string, priority = false): Promise<{ queued: boolean; alreadyQueued: boolean }> {
		const item = await this.find(id);
		if (item.isPlaceholder || !item.path) {
			throw new BadRequest("This item has no files on disk to rescan.");
		}
		const series = item.type === "season" || item.type === "episode" ? await this.findSeriesParent(item) : null;
		return this.indexer.request("POST", "/internal/refresh", {
			body: {
				libraryId: item.libraryId,
				path: item.path,
				itemType: item.type,
				priority,
				providerIds: item.providerIds ?? {},
				...(series ? { seriesProviderIds: series.providerIds ?? {} } : {}),
			},
		});
	}

	private async findSeriesParent(item: MediaItem): Promise<MediaItem | null> {
		const repository = this.dataSource.getRepository(MediaItem);
		let parentId = item.parentId;
		while (parentId) {
			const parent = await repository.findOneBy({ id: parentId });
			if (!parent) return null;
			if (parent.type === "series") return parent;
			parentId = parent.parentId;
		}
		return null;
	}

	/** Removes the item and everything under it. A later scan will add it back if the files still exist. */
	async remove(id: string): Promise<void> {
		const repository = this.dataSource.getRepository(MediaItem);
		const item = await this.find(id);
		const result = await repository.delete({ id });
		if (!result.affected) {
			throw new NotFound("Media item not found.");
		}
		for (const image of item.images ?? []) {
			await deleteUpload(uploadFilename((image as StoredImage).path));
		}
	}

	private async find(id: string): Promise<MediaItem> {
		const item = await this.dataSource.getRepository(MediaItem).findOneBy({ id });
		if (!item) {
			throw new NotFound("Media item not found.");
		}
		return item;
	}

	private toListItem(item: MediaItemListFields) {
		return {
			id: item.id,
			libraryId: item.libraryId,
			parentId: item.parentId,
			type: item.type as MediaItemType,
			title: item.title,
			year: item.year,
			seasonNumber: item.seasonNumber,
			episodeNumber: item.episodeNumber,
			path: item.path,
			providerIds: item.providerIds,
			sizeBytes: item.sizeBytes,
			edited: (item.editedFields ?? []).length > 0,
			poster:
				item.type === "track"
					? manualPosterIndex(item.images)
					: item.type === "episode"
						? episodeArtworkIndex(item.images)
						: posterIndex(item.images),
			updatedAt: item.updatedAt,
		};
	}
}
