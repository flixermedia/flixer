import { Inject, Injectable } from "@tsed/di";
import { BadRequest, NotFound } from "@tsed/exceptions";
import { DataSource } from "typeorm";
import { DefaultDataSource } from "../../datasources/defaultDataSource.datasource.js";
import { MEDIA_ITEM_TYPES, MediaItem, type MediaItemType } from "../../entities/mediaItem.entity.js";
import { IndexerClient } from "../indexer/indexerClient.js";
import { UpdateMediaItemRequest } from "./adminMediaRequests.js";
import { normalizeWidth, resizeImage } from "./mediaImageResizer.js";
import { deleteUpload, detectImageType, MANUAL_PROVIDER, MAX_MEDIA_IMAGE_BYTES, mimeForUpload, readUpload, saveUpload, UPLOAD_PREFIX, uploadFilename } from "./mediaImageStorage.js";

export const MEDIA_IMAGE_TYPES = ["poster", "backdrop", "logo", "banner", "thumb", "disc"] as const;
const MAX_IMAGES_PER_ITEM = 60;

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
			if (!(MEDIA_ITEM_TYPES as readonly string[]).includes(query.type)) {
				throw new BadRequest(`type must be one of ${MEDIA_ITEM_TYPES.join(", ")}.`);
			}
			builder.andWhere("item.type = :type", { type: query.type });
		}
		if (query.parentId) {
			builder.andWhere("item.parent_id = :parentId", { parentId: query.parentId });
		}
		const search = query.search?.trim();
		// Unfiltered, list only top-level items (movies, shows, albums); seasons, episodes and tracks are browsed through their parent.
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

		const items = entities.map((item, index) => ({ ...this.toListItem(item), parentTitle: (raw[index]?.parentTitle as string | null) ?? null }));
		return { items, total, page, size };
	}

	async get(id: string) {
		const item = await this.find(id);
		const parent = item.parentId ? await this.dataSource.getRepository(MediaItem).findOneBy({ id: item.parentId }) : null;
		const childCount = await this.dataSource.getRepository(MediaItem).countBy({ parentId: item.id });
		const { images, ...rest } = item;
		return { ...rest, images: (images ?? []).map(toImage), parent: parent ? { id: parent.id, title: parent.title, type: parent.type } : null, childCount };
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
		const filename = await saveUpload(item.id, buffer, detected);
		item.images = [...(item.images ?? []), { type, path: `${UPLOAD_PREFIX}${filename}`, provider: MANUAL_PROVIDER }];
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
				(item as unknown as Record<string, unknown>)[field] = typeof value === "string" && field === "sortTitle" && value.trim() === "" ? null : value;
				edited.add(field);
			}
		}
		if (request.overview !== undefined) {
			const { overview: _previous, ...rest } = item.metadata ?? {};
			item.metadata = request.overview === null || request.overview.trim() === "" ? rest : { ...rest, overview: request.overview };
			edited.add("overview");
		}

		item.editedFields = [...edited];
		await repository.save(item);
		return this.get(id);
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

	private toListItem(item: MediaItem) {
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
			poster: posterIndex(item.images),
			updatedAt: item.updatedAt,
		};
	}
}
