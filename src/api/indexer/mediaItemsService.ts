import { NotificationService } from "../notifications/notificationService.js";
import { Inject, Injectable } from "@tsed/di";
import { BadRequest, NotFound } from "@tsed/exceptions";
import { randomUUID } from "node:crypto";
import { DataSource, EntityManager } from "typeorm";
import { DefaultDataSource } from "../../datasources/defaultDataSource.datasource.js";
import { MEDIA_ITEM_TYPES, MediaItem, type MediaItemType } from "../../entities/mediaItem.entity.js";
import { MediaCredit, personIdOf, personKeyOf } from "../../entities/mediaCredit.entity.js";
import { allowedPersonImage } from "../media/personImages.js";
import { MediaLibrary } from "../../entities/mediaLibrary.entity.js";

const CREDITED_TYPES: MediaItemType[] = ["movie", "series", "album", "video"];
/** What flixer-indexer sends to POST /api/indexer/media/items. */
export interface IndexerItemPayload {
	libraryId: string;
	type: MediaItemType;
	path: string;
	externalKey: string;
	parentPath?: string;
	parentExternalKey?: string;
	parentProviderIds: Record<string, string>;
	rootId?: string;
	relativePath?: string;
	seasonNumber?: number;
	episodeNumber?: number;
	episodeEndNumber?: number;
	providerIds: Record<string, string>;
	metadata: Record<string, unknown>;
	images: unknown[];
	updateFields?: IndexerUpdateField[];
	technical?: Record<string, unknown>;
	sizeBytes?: number;
	modifiedAt?: Date;
	nfoPresent: boolean;
	localImagesUsed: boolean;
}

function parseUpdateFields(value: unknown): IndexerUpdateField[] | undefined {
	if (value === undefined) return undefined;
	if (!Array.isArray(value) || value.length === 0) {
		throw new BadRequest("updateFields must contain unique supported fields.");
	}
	const fields: IndexerUpdateField[] = [];
	for (const field of value) {
		if (!isIndexerUpdateField(field)) {
			throw new BadRequest("updateFields must contain unique supported fields.");
		}
		fields.push(field);
	}
	if (new Set(fields).size !== fields.length) {
		throw new BadRequest("updateFields must contain unique supported fields.");
	}
	return fields;
}

function isIndexerUpdateField(value: unknown): value is IndexerUpdateField {
	return typeof value === "string" && INDEXER_UPDATE_FIELDS.has(value);
}

/** The type a parent must have; other types have no parent item (a video's folder is not an item). */
const PARENT_TYPES: Partial<Record<MediaItemType, MediaItemType>> = {
	season: "series",
	episode: "season",
	track: "album",
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_KEY_LENGTH = 2048;
const PATH_KEY_PREFIX = "path:";
const CLOCK_SKEW_MS = 60_000;
type IndexerUpdateField = "images" | "descriptions" | "fileData" | "lyrics";
const INDEXER_UPDATE_FIELDS: ReadonlySet<string> = new Set(["images", "descriptions", "fileData", "lyrics"]);

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalText(value: unknown, field: string, maxLength = 4096): string | undefined {
	if (value === undefined || value === null || value === "") {
		return undefined;
	}
	if (typeof value !== "string" || value.length > maxLength) {
		throw new BadRequest(`${field} must be text.`);
	}
	return value;
}

function optionalInt(value: unknown, field: string): number | undefined {
	if (value === undefined || value === null) {
		return undefined;
	}
	if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
		throw new BadRequest(`${field} must be a whole number.`);
	}
	return value;
}

function stringMap(value: unknown, field: string): Record<string, string> {
	if (value === undefined || value === null) {
		return {};
	}
	if (!isRecord(value) || Object.values(value).some((entry) => typeof entry !== "string")) {
		throw new BadRequest(`${field} must be an object of text values.`);
	}
	return value as Record<string, string>;
}

export function mergeIndexerProviderIds(
	incoming: Record<string, string>,
	current: Record<string, string>,
	editedFields: readonly string[],
): Record<string, string> {
	const result = { ...incoming };
	for (const field of editedFields) {
		if (!field.startsWith("providerId:")) continue;
		const provider = field.slice("providerId:".length);
		if (Object.hasOwn(current, provider)) result[provider] = current[provider];
	}
	return result;
}

/** Validates the indexer's JSON body. */
export function parseItemPayload(body: unknown): IndexerItemPayload {
	if (!isRecord(body)) {
		throw new BadRequest("The request body must be a JSON object.");
	}
	if (typeof body.libraryId !== "string" || !UUID_PATTERN.test(body.libraryId)) {
		throw new BadRequest("libraryId must be a library id.");
	}
	if (typeof body.type !== "string" || !(MEDIA_ITEM_TYPES as readonly string[]).includes(body.type)) {
		throw new BadRequest("type is not a known item type.");
	}
	const path = optionalText(body.path, "path");
	const externalKey = optionalText(body.externalKey, "externalKey", MAX_KEY_LENGTH);
	if (!path || !externalKey) {
		throw new BadRequest("path and externalKey are required.");
	}
	if (body.metadata !== undefined && body.metadata !== null && !isRecord(body.metadata)) {
		throw new BadRequest("metadata must be an object.");
	}
	if (body.images !== undefined && body.images !== null && !Array.isArray(body.images)) {
		throw new BadRequest("images must be a list.");
	}
	const updateFields = parseUpdateFields(body.updateFields);
	if (body.technical !== undefined && body.technical !== null && !isRecord(body.technical)) {
		throw new BadRequest("technical must be an object.");
	}
	let modifiedAt: Date | undefined;
	if (typeof body.modifiedAt === "string" && body.modifiedAt) {
		modifiedAt = new Date(body.modifiedAt);
		if (Number.isNaN(modifiedAt.getTime())) {
			throw new BadRequest("modifiedAt must be a date.");
		}
	}

	return {
		libraryId: body.libraryId.toLowerCase(),
		type: body.type as MediaItemType,
		path,
		externalKey,
		parentPath: optionalText(body.parentPath, "parentPath"),
		parentExternalKey: optionalText(body.parentExternalKey, "parentExternalKey", MAX_KEY_LENGTH),
		parentProviderIds: stringMap(body.parentProviderIds, "parentProviderIds"),
		rootId: optionalText(body.rootId, "rootId", 64),
		relativePath: optionalText(body.relativePath, "relativePath"),
		seasonNumber: optionalInt(body.seasonNumber, "seasonNumber"),
		episodeNumber: optionalInt(body.episodeNumber, "episodeNumber"),
		episodeEndNumber: optionalInt(body.episodeEndNumber, "episodeEndNumber"),
		providerIds: stringMap(body.providerIds, "providerIds"),
		metadata: (body.metadata as Record<string, unknown> | null | undefined) ?? {},
		images: (body.images as unknown[] | null | undefined) ?? [],
		updateFields,
		technical: (body.technical as Record<string, unknown> | null | undefined) ?? undefined,
		sizeBytes: optionalInt(body.sizeBytes, "sizeBytes"),
		modifiedAt,
		nfoPresent: body.nfoPresent === true,
		localImagesUsed: body.localImagesUsed === true,
	};
}

function lastSegment(path: string): string {
	return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

/** Stores what flixer-indexer finds and keeps the series → season → episode (and album → track) tree linked. */
@Injectable()
export class MediaItemsService {
	constructor(
		@Inject(DefaultDataSource) private readonly dataSource: DataSource,
		private readonly notifications: NotificationService,
	) {}

	async upsert(payload: IndexerItemPayload): Promise<{ id: string }> {
		let announce: { id: string; type: string } | null = null;
		const result = await this.dataSource.transaction(async (manager) => {
			if (!(await manager.existsBy(MediaLibrary, { id: payload.libraryId }))) {
				throw new NotFound("Media library not found.");
			}

			// Parents are always locked after their children, so concurrent upserts cannot deadlock on each other.
			await this.lock(manager, payload.libraryId, payload.externalKey);

			// An item is first matched by its stable key; otherwise by path, which covers an item whose
			// key changed because it was identified (path:... becomes tmdb:...).
			let item =
				(await manager.findOneBy(MediaItem, {
					libraryId: payload.libraryId,
					externalKey: payload.externalKey,
				})) ??
				(await manager.findOneBy(MediaItem, {
					libraryId: payload.libraryId,
					path: payload.path,
					type: payload.type,
				})) ??
				// The library folder may have moved: the same content now sits under a different base path.
				(await this.findByRelativeKey(manager, payload.libraryId, payload.type, payload.externalKey));
			if (payload.updateFields?.length) {
				if (!item || item.isPlaceholder) {
					return { id: "" };
				}
				await this.updateSelectedFields(manager, item, payload);
				return { id: item.id };
			}
			// A placeholder parent becoming real counts as new too; users never saw it.
			const isNew = !item || item.isPlaceholder;
			item ??= manager.create(MediaItem, { id: randomUUID(), libraryId: payload.libraryId });

			const parentId = await this.resolveParent(manager, payload);
			const metadata = payload.metadata;

			const edited = new Set(item.editedFields ?? []);
			const incoming = {
				title: (typeof metadata.title === "string" && metadata.title.trim()) || lastSegment(payload.path),
				sortTitle: typeof metadata.sortTitle === "string" && metadata.sortTitle ? metadata.sortTitle : null,
				year: typeof metadata.year === "number" && metadata.year > 0 ? metadata.year : null,
				seasonNumber: payload.seasonNumber ?? null,
				episodeNumber: payload.episodeNumber ?? null,
				episodeEndNumber: payload.episodeEndNumber ?? null,
			};
			const keep = <K extends keyof typeof incoming>(field: K, current: (typeof incoming)[K]) =>
				edited.has(field) ? current : incoming[field];
			const keptOverview = edited.has("overview") ? item.metadata?.overview : undefined;

			item.type = payload.type;
			item.externalKey = payload.externalKey;
			item.path = payload.path;
			item.parentId = parentId !== item.id ? parentId : null;
			item.rootId = payload.rootId ?? null;
			item.relativePath = payload.relativePath ?? null;
			item.title = keep("title", item.title);
			item.sortTitle = keep("sortTitle", item.sortTitle);
			item.year = keep("year", item.year);
			item.seasonNumber = keep("seasonNumber", item.seasonNumber);
			item.episodeNumber = keep("episodeNumber", item.episodeNumber);
			item.episodeEndNumber = keep("episodeEndNumber", item.episodeEndNumber);
			item.providerIds = mergeIndexerProviderIds(payload.providerIds, item.providerIds ?? {}, [...edited]);
			item.metadata = edited.has("overview") ? { ...metadata, overview: keptOverview } : metadata;
			// Images an admin added are not the indexer's to replace.
			const manual = (item.images ?? []).filter(
				(image) => (image as { provider?: unknown }).provider === "manual",
			);
			item.images = [...payload.images, ...manual];
			item.technical = payload.technical ?? null;
			item.sizeBytes = payload.sizeBytes ?? null;
			item.modifiedAt = payload.modifiedAt ?? null;
			item.nfoPresent = payload.nfoPresent;
			item.localImagesUsed = payload.localImagesUsed;
			item.isPlaceholder = false;
			item.lastSeenAt = new Date();

			const saved = await manager.save(item);
			await this.syncCredits(manager, saved);
			announce = isNew ? { id: saved.id, type: saved.type } : null;
			return { id: saved.id };
		});
		// Only once the transaction has committed, so a rolled-back item is never announced.
		const created = announce as { id: string; type: string } | null;
		if (created) {
			this.notifications.announceNew(created.id, created.type);
		}
		return result;
	}

	private async updateSelectedFields(
		manager: EntityManager,
		item: MediaItem,
		payload: IndexerItemPayload,
	): Promise<void> {
		const fields = new Set(payload.updateFields);
		item.lastSeenAt = new Date();
		if (fields.has("images")) {
			if (payload.images.length > 0) {
				const incomingTypes = new Set(
					payload.images
						.map((image) => (image as { type?: unknown } | null)?.type)
						.filter((type): type is string => typeof type === "string"),
				);
				const manual = (item.images ?? []).filter(
					(image) => (image as { provider?: unknown }).provider === "manual",
				);
				const unchangedTypes = (item.images ?? []).filter((image) => {
					const current = image as { type?: unknown; provider?: unknown };
					return (
						current.provider !== "manual" &&
						typeof current.type === "string" &&
						!incomingTypes.has(current.type)
					);
				});
				item.images = [...payload.images, ...unchangedTypes, ...manual];
				item.localImagesUsed = payload.localImagesUsed;
			}
		}
		if (fields.has("descriptions")) {
			const metadata = payload.metadata;
			const edited = new Set(item.editedFields ?? []);
			const incoming = {
				title: (typeof metadata.title === "string" && metadata.title.trim()) || lastSegment(payload.path),
				sortTitle: typeof metadata.sortTitle === "string" && metadata.sortTitle ? metadata.sortTitle : null,
				year: typeof metadata.year === "number" && metadata.year > 0 ? metadata.year : null,
			};
			const keep = <K extends keyof typeof incoming>(field: K, current: (typeof incoming)[K]) =>
				edited.has(field) ? current : incoming[field];
			const keptOverview = edited.has("overview") ? item.metadata?.overview : undefined;
			item.title = keep("title", item.title);
			item.sortTitle = keep("sortTitle", item.sortTitle);
			item.year = keep("year", item.year);
			item.providerIds = mergeIndexerProviderIds(payload.providerIds, item.providerIds ?? {}, [...edited]);
			const mergedMetadata = { ...item.metadata };
			for (const [key, value] of Object.entries(metadata)) {
				if (
					value === null ||
					value === undefined ||
					value === "" ||
					(Array.isArray(value) && value.length === 0)
				) {
					continue;
				}
				mergedMetadata[key] = value;
			}
			item.metadata = edited.has("overview") ? { ...mergedMetadata, overview: keptOverview } : mergedMetadata;
			await this.syncCredits(manager, item);
		}
		if (fields.has("fileData")) {
			if (payload.rootId !== undefined) item.rootId = payload.rootId;
			if (payload.relativePath !== undefined) item.relativePath = payload.relativePath;
			if (payload.technical !== undefined) item.technical = payload.technical;
			if (payload.sizeBytes !== undefined) item.sizeBytes = payload.sizeBytes;
			if (payload.modifiedAt !== undefined) item.modifiedAt = payload.modifiedAt;
		}
		await manager.save(item);
	}

	/** Rewrites the item's credits from its metadata so they always match what the indexer last reported. */
	private async syncCredits(manager: EntityManager, item: MediaItem): Promise<void> {
		await manager.delete(MediaCredit, { itemId: item.id });
		if (!CREDITED_TYPES.includes(item.type)) {
			return;
		}
		const metadata = item.metadata ?? {};
		const credits = new Map<string, MediaCredit>();
		const add = (name: unknown, role: unknown, detail: unknown, position: number, image?: unknown) => {
			if (typeof name !== "string" || !name.trim() || typeof role !== "string") {
				return;
			}
			const personKey = personKeyOf(name);
			const key = `${personKey}|${role}`;
			if (!credits.has(key)) {
				credits.set(
					key,
					manager.create(MediaCredit, {
						itemId: item.id,
						personKey,
						personId: personIdOf(name),
						role,
						name: name.trim(),
						detail: typeof detail === "string" && detail.trim() ? detail.trim() : null,
						position,
						image: allowedPersonImage(image),
					}),
				);
			}
		};
		const people = (value: unknown, fallbackRole: string) => {
			if (!Array.isArray(value)) {
				return;
			}
			value.forEach((entry, index) => {
				const person = entry as { name?: unknown; type?: unknown; role?: unknown; image?: unknown } | null;
				const type =
					typeof person?.type === "string" && person.type.trim()
						? person.type.trim().toLowerCase()
						: fallbackRole;
				add(person?.name, type, person?.role, index + 1, person?.image);
			});
		};
		people(metadata.cast, "actor");
		people(metadata.crew, "crew");
		if (item.type === "album") {
			add(metadata.artist, "artist", null, 0);
			add(metadata.albumArtist, "albumArtist", null, 0);
		}
		if (credits.size > 0) {
			await manager.insert(MediaCredit, [...credits.values()]);
		}
	}

	private async lock(manager: EntityManager, libraryId: string, key: string): Promise<void> {
		await manager.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`flixer:media-item:${libraryId}:${key}`]);
	}

	/**
	 * Unidentified items are keyed "path:<path inside the library folder>". When a library is pointed at another
	 * folder holding the same content, the old row is the one whose stored path ends with that relative path.
	 * Only an unambiguous match is used.
	 */
	private async findByRelativeKey(
		manager: EntityManager,
		libraryId: string,
		type: MediaItemType,
		key: string,
	): Promise<MediaItem | null> {
		if (!key.startsWith(PATH_KEY_PREFIX)) {
			return null;
		}
		const relative = key.slice(PATH_KEY_PREFIX.length);
		if (!relative || relative === "." || relative.startsWith("/") || /^[A-Za-z]:[\\/]/.test(relative)) {
			return null;
		}
		const escaped = relative.replace(/[\\%_]/g, (character) => `\\${character}`);
		const matches = await manager
			.createQueryBuilder(MediaItem, "item")
			.where("item.libraryId = :libraryId AND item.type = :type", { libraryId, type })
			.andWhere("item.path LIKE :suffix", { suffix: `%/${escaped}` })
			.limit(2)
			.getMany();
		return matches.length === 1 ? matches[0] : null;
	}

	/**
	 * Removes what a finished scan did not find: content that left the library's folders, or that was only
	 * reachable through a folder the library no longer uses. Placeholders are kept while anything hangs off them.
	 */
	async prune(libraryId: string, scanStartedAt: Date): Promise<{ removed: number }> {
		// The indexer's clock may run ahead of ours; never treat an item seen during this scan as stale.
		const cutoff = new Date(scanStartedAt.getTime() - CLOCK_SKEW_MS);
		return this.dataSource.transaction(async (manager) => {
			if (!(await manager.existsBy(MediaLibrary, { id: libraryId }))) {
				throw new NotFound("Media library not found.");
			}
			const stale = await manager
				.createQueryBuilder()
				.delete()
				.from(MediaItem)
				.where("library_id = :libraryId AND is_placeholder = false", { libraryId })
				.andWhere("(last_seen_at IS NULL OR last_seen_at < :cutoff)", { cutoff })
				.execute();
			const orphans = await manager.query(
				`DELETE FROM media_items p WHERE p.library_id = $1 AND p.is_placeholder = true AND NOT EXISTS (SELECT 1 FROM media_items c WHERE c.parent_id = p.id)`,
				[libraryId],
			);
			const orphanCount = Array.isArray(orphans) ? Number(orphans[1] ?? 0) : 0;
			return { removed: (stale.affected ?? 0) + orphanCount };
		});
	}

	/**
	 * Finds the parent by its stable key, then by the series' provider ids (it may have been identified through a
	 * different provider), then by path. If it has not been indexed yet a placeholder is created, which the real
	 * item replaces when it arrives.
	 */
	private async resolveParent(manager: EntityManager, payload: IndexerItemPayload): Promise<string | null> {
		const parentType = PARENT_TYPES[payload.type];
		if (!parentType) {
			return null;
		}
		const { libraryId, parentExternalKey, parentPath } = payload;

		if (parentExternalKey) {
			await this.lock(manager, libraryId, parentExternalKey);
			const byKey = await manager.findOneBy(MediaItem, { libraryId, externalKey: parentExternalKey });
			if (byKey) {
				return byKey.id;
			}
		}
		const byProviderIds = await this.findParentByProviderIds(manager, payload, parentType);
		if (byProviderIds) {
			return byProviderIds;
		}
		if (parentPath) {
			const byPath = await manager.findOneBy(MediaItem, { libraryId, path: parentPath, type: parentType });
			if (byPath) {
				return byPath.id;
			}
		}
		if (parentExternalKey) {
			const moved = await this.findByRelativeKey(manager, libraryId, parentType, parentExternalKey);
			if (moved) {
				return moved.id;
			}
		}
		if (!parentExternalKey) {
			return null;
		}

		const placeholder = manager.create(MediaItem, {
			id: randomUUID(),
			libraryId,
			type: parentType,
			externalKey: parentExternalKey,
			path: parentPath ?? "",
			title: parentPath ? lastSegment(parentPath) : parentExternalKey,
			seasonNumber: parentType === "season" ? (payload.seasonNumber ?? null) : null,
			providerIds: parentType === "series" ? payload.parentProviderIds : {},
			metadata: {},
			images: [],
			isPlaceholder: true,
		});
		return (await manager.save(placeholder)).id;
	}

	private async findParentByProviderIds(
		manager: EntityManager,
		payload: IndexerItemPayload,
		parentType: MediaItemType,
	): Promise<string | null> {
		const ids = Object.entries(payload.parentProviderIds).filter(([, id]) => id);
		if (ids.length === 0 || (parentType !== "series" && parentType !== "season")) {
			return null;
		}
		const params: Record<string, string | number> = { library: payload.libraryId };
		ids.forEach(([provider, id], index) => {
			params[`provider${index}`] = provider;
			params[`id${index}`] = id;
		});
		const matches = (alias: string) =>
			ids.map((_, index) => `${alias}.providerIds ->> :provider${index} = :id${index}`).join(" OR ");

		if (parentType === "series") {
			const series = await manager
				.createQueryBuilder(MediaItem, "series")
				.where("series.libraryId = :library AND series.type = 'series'")
				.andWhere(`(${matches("series")})`)
				.setParameters(params)
				.getOne();
			return series?.id ?? null;
		}

		if (payload.seasonNumber === undefined) {
			return null;
		}
		const season = await manager
			.createQueryBuilder(MediaItem, "season")
			.innerJoin(MediaItem, "series", "series.id = season.parentId")
			.where("season.libraryId = :library AND season.type = 'season' AND season.seasonNumber = :seasonNumber")
			.andWhere(`(${matches("series")})`)
			.setParameters({ ...params, seasonNumber: payload.seasonNumber })
			.getOne();
		return season?.id ?? null;
	}
}
