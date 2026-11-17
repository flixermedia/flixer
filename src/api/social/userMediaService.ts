import { Inject, Injectable } from "@tsed/di";
import { BadRequest, NotFound } from "@tsed/exceptions";
import { randomUUID } from "node:crypto";
import { DataSource, IsNull, Not, type EntityManager } from "typeorm";
import { DefaultDataSource } from "../../datasources/defaultDataSource.datasource.js";
import { MediaItem } from "../../entities/mediaItem.entity.js";
import { SocialFriendship } from "../../entities/social.entity.js";
import { User } from "../../entities/user.entity.js";
import { RecommendationFeedback, UpNextQueueItem, WatchLaterItem } from "../../entities/userMediaQueue.entity.js";
import { UserPreference } from "../../entities/userPreference.entity.js";
import { VideoCollection, VideoCollectionItem } from "../../entities/videoCollection.entity.js";
import { MediaAccessService, type AccessPolicy } from "../access/mediaAccessService.js";
import { loadSocialItems, toSocialItem, type SocialItem } from "./socialItems.js";

const VIDEO_TYPES = ["movie", "series", "season", "episode", "video"];
const PLAYABLE_VIDEO_TYPES = ["movie", "episode", "video"];
const MAX_COLLECTIONS = 100;
const MAX_COLLECTION_ITEMS = 2000;
const MAX_QUEUE_ITEMS = 500;
export const MAX_HISTORY_PAGE_SIZE = 200;

// RAW SQL: CTEs and window functions grouping consecutive history rows
const HISTORY_GROUPS_SQL = `
	WITH resolved_history AS (
		SELECT history.*,
			CASE
				WHEN item.type = 'episode' AND parent.type = 'series' AND parent.is_placeholder = false THEN parent.id
				WHEN item.type = 'episode' AND series.id IS NOT NULL THEN series.id
				WHEN item.type = 'track' AND parent.type = 'album' AND parent.is_placeholder = false THEN parent.id
				ELSE history.item_id
			END AS group_item_id
		FROM playback_history history
		LEFT JOIN media_items item ON item.id = history.item_id
		LEFT JOIN media_items parent ON parent.id = item.parent_id AND item.type IN ('episode', 'track')
		LEFT JOIN media_items series ON series.id = parent.parent_id AND parent.type = 'season' AND series.type = 'series' AND series.is_placeholder = false
		WHERE history.user_id = $1
	), ordered_history AS (
		SELECT resolved_history.*,
			lag(kind) OVER history_order AS previous_kind,
			lag(group_item_id) OVER history_order AS previous_item_id,
			lag(channel_id) OVER history_order AS previous_channel_id
		FROM resolved_history
		WINDOW history_order AS (ORDER BY started_at DESC, id DESC)
	), grouped_history AS (
		SELECT ordered_history.*,
			sum(CASE WHEN kind IS DISTINCT FROM previous_kind OR group_item_id IS DISTINCT FROM previous_item_id
				OR channel_id IS DISTINCT FROM previous_channel_id THEN 1 ELSE 0 END)
				OVER (ORDER BY started_at DESC, id DESC ROWS UNBOUNDED PRECEDING) AS group_number
		FROM ordered_history
	)`;

interface HistoryRow {
	id: string;
	kind: "video" | "music" | "live";
	item_id: string | null;
	source_item_ids: string[];
	channel_name: string | null;
	watched_seconds: number;
	started_at: Date;
	updated_at: Date;
}

interface CollectionRow {
	id: string;
	user_id: string;
	name: string;
	description: string | null;
	is_public: boolean;
	created_at: Date;
	updated_at: Date;
}

@Injectable()
export class UserMediaService {

	constructor(
		@Inject(DefaultDataSource) private readonly dataSource: DataSource,
		private readonly access: MediaAccessService,
	) {}

	async history(userId: string, offset = 0, limit = MAX_HISTORY_PAGE_SIZE + 1) {
		// RAW SQL: window functions and CTEs with array_agg grouping over playback_history
		const rows = (await this.dataSource.query(
			`${HISTORY_GROUPS_SQL}
			SELECT (array_agg(id ORDER BY started_at DESC, id DESC))[1] AS id, kind, group_item_id AS item_id,
				COALESCE(array_agg(DISTINCT item_id) FILTER (WHERE item_id IS NOT NULL), ARRAY[]::uuid[]) AS source_item_ids,
				(array_agg(channel_name ORDER BY started_at DESC, id DESC))[1] AS channel_name,
				sum(watched_seconds)::float8 AS watched_seconds, max(started_at) AS started_at, max(updated_at) AS updated_at
			FROM grouped_history GROUP BY group_number, kind, group_item_id, channel_id
			ORDER BY group_number LIMIT $2 OFFSET $3`,
			[userId, limit, offset],
		)) as HistoryRow[];
		const ids = rows.flatMap((row) => (row.item_id ? [row.item_id] : []));
		const items = await loadSocialItems(this.dataSource, ids);
		const byId = new Map(items.map((item) => [item.id, toSocialItem(item)]));
		return rows.map((row) => ({
			id: row.id,
			kind: row.kind,
			watchedSeconds: row.watched_seconds,
			startedAt: row.started_at,
			updatedAt: row.updated_at,
			item: row.item_id ? (byId.get(row.item_id) ?? null) : null,
			sourceItemIds: row.source_item_ids,
			channelName: row.channel_name,
		}));
	}

	async clearHistory(userId: string): Promise<void> {
		// RAW SQL: data-modifying CTE moving playback_history into hidden sessions
		await this.dataSource.query(
			`
			WITH hidden AS (
				INSERT INTO playback_history_hidden_sessions (user_id, id)
				SELECT user_id, id FROM playback_history WHERE user_id = $1 ON CONFLICT DO NOTHING
			)
			DELETE FROM playback_history WHERE user_id = $1`,
			[userId],
		);
	}

	async removeHistory(userId: string, id: string): Promise<void> {
		// RAW SQL: window-function CTEs with data-modifying CTE over playback_history
		await this.dataSource.query(
			`
			${HISTORY_GROUPS_SQL}, target_group AS (
				SELECT group_number FROM grouped_history WHERE id = $2
			), hidden AS (
				INSERT INTO playback_history_hidden_sessions (user_id, id)
				SELECT user_id, id FROM grouped_history WHERE group_number = (SELECT group_number FROM target_group)
				ON CONFLICT DO NOTHING
			)
			DELETE FROM playback_history WHERE user_id = $1
			AND id IN (SELECT id FROM grouped_history WHERE group_number = (SELECT group_number FROM target_group))`,
			[userId, id],
		);
	}

	async watchLater(userId: string): Promise<SocialItem[]> {
		const rows = await this.dataSource.getRepository(WatchLaterItem).find({ select: { itemId: true, addedAt: true }, where: { userId }, order: { addedAt: "DESC" }, take: 500 });
		const at = new Map(rows.map((row) => [row.itemId, row.addedAt]));
		return (
			await loadSocialItems(
				this.dataSource,
				rows.map((row) => row.itemId),
				at,
			)
		).map(toSocialItem);
	}

	async watchLaterIds(userId: string): Promise<string[]> {
		const rows = await this.dataSource.getRepository(WatchLaterItem).find({ select: { itemId: true }, where: { userId } });
		return rows.map((row) => row.itemId);
	}

	async addWatchLater(userId: string, itemId: string): Promise<void> {
		await this.requireVideoItem(itemId);
		await this.dataSource.createQueryBuilder().insert().into(WatchLaterItem).values({ userId, itemId }).orIgnore().updateEntity(false).execute();
	}

	async removeWatchLater(userId: string, itemId: string): Promise<void> {
		await this.dataSource.getRepository(WatchLaterItem).delete({ userId, itemId });
	}

	async collections(userId: string, policy: AccessPolicy) {
		const collections = this.collectionRows(
			// RAW SQL: LEFT JOIN with count aggregate and GROUP BY over video_collection_items
			(await this.dataSource.query(
				`SELECT c.*, count(ci.item_id)::int AS item_count
				FROM video_collections c LEFT JOIN video_collection_items ci ON ci.collection_id = c.id
				WHERE c.user_id = $1 GROUP BY c.id ORDER BY c.updated_at DESC`,
				[userId],
			)) as Array<CollectionRow & { item_count: number }>,
		);
		if (!collections.length) return collections;
		// RAW SQL: query builder joining collections to items with array_agg slice and count cast
		const query = this.dataSource.getRepository(MediaItem).createQueryBuilder("item").innerJoin("video_collection_items", "entry", "entry.item_id = item.id").innerJoin("video_collections", "collection", "collection.id = entry.collection_id").where("collection.user_id = :userId", { userId }).andWhere("item.is_placeholder = false").select("entry.collection_id", "collectionId").addSelect("count(*)::int", "visibleItemCount").addSelect("(array_agg(item.id ORDER BY entry.position ASC))[1:8]", "itemIds").groupBy("entry.collection_id");
		this.access.restrict(query, "item", policy, { content: true });
		const previews = await query.getRawMany<{ collectionId: string; itemIds: string[]; visibleItemCount: number }>();
		const cards = await loadSocialItems(
			this.dataSource,
			previews.flatMap((preview) => preview.itemIds),
		);
		const cardsById = new Map(cards.map((card) => [card.id, card]));
		const previewsById = new Map(previews.map((preview) => [preview.collectionId, preview]));
		return collections.map((collection) => {
			const preview = previewsById.get(collection.id);
			const cover = (preview?.itemIds ?? []).map((itemId) => cardsById.get(itemId)).find((card) => card?.imageIndex !== null && card?.imageIndex !== undefined);
			return { ...collection, visibleItemCount: Number(preview?.visibleItemCount ?? 0), cover: cover ? { itemId: cover.imageItemId, index: cover.imageIndex, version: cover.imageUpdatedAt } : null };
		});
	}

	async createCollection(userId: string, input: { name: string; description?: string | null; isPublic?: boolean }) {
		const name = input.name?.trim();
		if (!name || name.length > 100) throw new BadRequest("Collection name must be 1 to 100 characters.");
		const repo = this.dataSource.getRepository(VideoCollection);
		if ((await repo.countBy({ userId })) >= MAX_COLLECTIONS) throw new BadRequest(`You can have up to ${MAX_COLLECTIONS} video collections.`);
		const created = await repo.save(repo.create({ id: randomUUID(), userId, name, description: this.cleanDescription(input.description), isPublic: input.isPublic ?? false }));
		return { id: created.id, name: created.name, description: created.description, isPublic: created.isPublic, itemCount: 0, createdAt: created.createdAt, updatedAt: created.updatedAt };
	}

	async updateCollection(userId: string, id: string, changes: { name?: string; description?: string | null; isPublic?: boolean }) {
		const collection = await this.ownedCollection(userId, id);
		if (changes.name !== undefined) {
			const name = changes.name.trim();
			if (!name || name.length > 100) throw new BadRequest("Collection name must be 1 to 100 characters.");
			collection.name = name;
		}
		if (changes.description !== undefined) collection.description = this.cleanDescription(changes.description);
		if (typeof changes.isPublic === "boolean") collection.isPublic = changes.isPublic;
		// RAW SQL: UPDATE ... RETURNING with count subselect and DB-side now()
		const rows = (await this.dataSource.query(
			`UPDATE video_collections SET name = $3, description = $4, is_public = $5, updated_at = now()
			WHERE id = $1 AND user_id = $2 RETURNING *, (SELECT count(*)::int FROM video_collection_items WHERE collection_id = $1) AS item_count`,
			[id, userId, collection.name, collection.description, collection.isPublic],
		)) as Array<CollectionRow & { item_count: number }>;
		return this.collectionRows(rows)[0];
	}

	async deleteCollection(userId: string, id: string): Promise<void> {
		await this.dataSource.getRepository(VideoCollection).delete({ id, userId });
	}

	async collection(viewerId: string, id: string) {
		// RAW SQL: LEFT JOIN with count aggregate and GROUP BY over video_collection_items
		const rows = (await this.dataSource.query(
			`SELECT c.*, count(ci.item_id)::int AS item_count
			FROM video_collections c LEFT JOIN video_collection_items ci ON ci.collection_id = c.id
			WHERE c.id = $1 GROUP BY c.id`,
			[id],
		)) as Array<CollectionRow & { item_count: number }>;
		const collection = rows[0];
		if (!collection) throw new NotFound("Collection not found.");
		const isOwner = collection.user_id === viewerId;
		if (!isOwner && (!collection.is_public || !(await this.ownerVisible(viewerId, collection.user_id)))) throw new NotFound("Collection not found.");
		const entries = await this.dataSource.getRepository(VideoCollectionItem).find({ select: { itemId: true, addedAt: true }, where: { collectionId: id }, order: { position: "ASC" } });
		const cards = await loadSocialItems(
			this.dataSource,
			entries.map((entry) => entry.itemId),
			new Map(entries.map((entry) => [entry.itemId, entry.addedAt])),
		);
		return { ...this.collectionRows([collection])[0], isOwner, items: cards.map(toSocialItem) };
	}

	async addCollectionItem(userId: string, id: string, itemId: string): Promise<void> {
		await this.ownedCollection(userId, id);
		await this.requireVideoItem(itemId);
		await this.dataSource.transaction(async (manager) => {
			const owned = await manager.findOne(VideoCollection, { select: { id: true }, where: { id, userId }, lock: { mode: "pessimistic_write" } });
			if (!owned) throw new NotFound("Collection not found.");
			// RAW SQL: count/max aggregate with int casts
			const rows = (await manager.query("SELECT count(*)::int AS count, COALESCE(max(position) + 1, 0)::int AS next FROM video_collection_items WHERE collection_id = $1", [id])) as Array<{ count: number; next: number }>;
			if (rows[0].count >= MAX_COLLECTION_ITEMS) throw new BadRequest(`A collection can hold up to ${MAX_COLLECTION_ITEMS} items.`);
			await manager.createQueryBuilder().insert().into(VideoCollectionItem).values({ collectionId: id, itemId, position: rows[0].next }).orIgnore().updateEntity(false).execute();
			await manager.update(VideoCollection, { id }, { updatedAt: () => "now()" });
		});
	}

	async removeCollectionItem(userId: string, id: string, itemId: string): Promise<void> {
		await this.dataSource.transaction(async (manager) => {
			const owned = await manager.findOne(VideoCollection, { select: { id: true }, where: { id, userId }, lock: { mode: "pessimistic_write" } });
			if (!owned) throw new NotFound("Collection not found.");
			await manager.delete(VideoCollectionItem, { collectionId: id, itemId });
			await manager.update(VideoCollection, { id }, { updatedAt: () => "now()" });
		});
	}

	async reorderCollection(userId: string, id: string, itemIds: string[]): Promise<void> {
		if (itemIds.length > MAX_COLLECTION_ITEMS || new Set(itemIds).size !== itemIds.length) throw new BadRequest("Invalid collection order.");
		await this.dataSource.transaction(async (manager) => {
			const owned = await manager.findOne(VideoCollection, { select: { id: true }, where: { id, userId }, lock: { mode: "pessimistic_write" } });
			if (!owned) throw new NotFound("Collection not found.");
			const rows = await manager.find(VideoCollectionItem, { select: { itemId: true }, where: { collectionId: id } });
			if (rows.length !== itemIds.length || rows.some((row) => !itemIds.includes(row.itemId))) throw new BadRequest("Order must contain every collection item exactly once.");
			// RAW SQL: UPDATE with MAX subselect (shifts positions clear of the unique constraint)
			await manager.query("UPDATE video_collection_items SET position = position + (SELECT COALESCE(MAX(position), 0) + 1 FROM video_collection_items WHERE collection_id = $1) WHERE collection_id = $1", [id]);
			// RAW SQL: UPDATE ... FROM unnest WITH ORDINALITY
			await manager.query("UPDATE video_collection_items entry SET position = ordered.ordinality - 1 FROM unnest($2::uuid[]) WITH ORDINALITY AS ordered(item_id, ordinality) WHERE entry.collection_id = $1 AND entry.item_id = ordered.item_id", [id, itemIds]);
			await manager.update(VideoCollection, { id }, { updatedAt: () => "now()" });
		});
	}

	async queue(userId: string): Promise<SocialItem[]> {
		const rows = await this.dataSource.getRepository(UpNextQueueItem).find({ select: { itemId: true, addedAt: true }, where: { userId }, order: { position: "ASC" } });
		return (
			await loadSocialItems(
				this.dataSource,
				rows.map((row) => row.itemId),
				new Map(rows.map((row) => [row.itemId, row.addedAt])),
			)
		).map(toSocialItem);
	}

	async addToQueue(userId: string, itemId: string): Promise<void> {
		await this.requireVideoItem(itemId, PLAYABLE_VIDEO_TYPES);
		await this.dataSource.transaction(async (manager) => {
			await this.lockUser(manager, userId);
			// RAW SQL: count/max aggregate with int casts
			const rows = (await manager.query("SELECT count(*)::int AS count, COALESCE(max(position) + 1, 0)::int AS next FROM up_next_queue_items WHERE user_id = $1", [userId])) as Array<{ count: number; next: number }>;
			if (rows[0].count >= MAX_QUEUE_ITEMS) throw new BadRequest(`Up Next can hold up to ${MAX_QUEUE_ITEMS} items.`);
			await manager.createQueryBuilder().insert().into(UpNextQueueItem).values({ userId, itemId, position: rows[0].next }).orIgnore().updateEntity(false).execute();
		});
	}

	async removeFromQueue(userId: string, itemId: string): Promise<void> {
		await this.dataSource.transaction(async (manager) => {
			await this.lockUser(manager, userId);
			await manager.delete(UpNextQueueItem, { userId, itemId });
		});
	}

	async clearQueue(userId: string): Promise<void> {
		await this.dataSource.transaction(async (manager) => {
			await this.lockUser(manager, userId);
			await manager.delete(UpNextQueueItem, { userId });
		});
	}

	async reorderQueue(userId: string, itemIds: string[]): Promise<void> {
		if (itemIds.length > MAX_QUEUE_ITEMS || new Set(itemIds).size !== itemIds.length) throw new BadRequest("Invalid queue order.");
		await this.dataSource.transaction(async (manager) => {
			await this.lockUser(manager, userId);
			const rows = await manager.find(UpNextQueueItem, { select: { itemId: true }, where: { userId } });
			if (rows.length !== itemIds.length || rows.some((row) => !itemIds.includes(row.itemId))) throw new BadRequest("Order must contain every queued item exactly once.");
			// RAW SQL: UPDATE with MAX subselect (shifts positions clear of the unique constraint)
			await manager.query("UPDATE up_next_queue_items SET position = position + (SELECT COALESCE(MAX(position), 0) + 1 FROM up_next_queue_items WHERE user_id = $1) WHERE user_id = $1", [userId]);
			// RAW SQL: UPDATE ... FROM unnest WITH ORDINALITY
			await manager.query("UPDATE up_next_queue_items entry SET position = ordered.ordinality - 1 FROM unnest($2::uuid[]) WITH ORDINALITY AS ordered(item_id, ordinality) WHERE entry.user_id = $1 AND entry.item_id = ordered.item_id", [userId, itemIds]);
		});
	}

	async setRecommendationFeedback(userId: string, itemId: string, feedback: "dismiss" | "more_like_this" | "less_like_this"): Promise<void> {
		const item = await this.dataSource.getRepository(MediaItem).findOne({
			where: { id: itemId, isPlaceholder: false },
			select: { id: true, type: true },
		});
		if (!item || !["movie", "series", "album", "video"].includes(item.type)) throw new NotFound("Recommendation item not found.");
		// RAW SQL: ON CONFLICT DO UPDATE with DB-side now()
		await this.dataSource.query(
			`INSERT INTO recommendation_feedback (user_id, item_id, feedback) VALUES ($1, $2, $3)
			ON CONFLICT (user_id, item_id) DO UPDATE SET feedback = EXCLUDED.feedback, updated_at = now()`,
			[userId, itemId, feedback],
		);
	}

	async clearRecommendationFeedback(userId: string, itemId: string): Promise<void> {
		await this.dataSource.getRepository(RecommendationFeedback).delete({ userId, itemId });
	}

	async dismissedRecommendations(userId: string): Promise<string[]> {
		const rows = await this.dataSource.getRepository(RecommendationFeedback).find({ select: { itemId: true }, where: { userId, feedback: "dismiss" } });
		return rows.map((row) => row.itemId);
	}

	async dismissedRecommendationItems(userId: string): Promise<SocialItem[]> {
		const rows = await this.dataSource.getRepository(RecommendationFeedback).find({ select: { itemId: true, updatedAt: true }, where: { userId, feedback: "dismiss" }, order: { updatedAt: "DESC" } });
		return (
			await loadSocialItems(
				this.dataSource,
				rows.map((row) => row.itemId),
				new Map(rows.map((row) => [row.itemId, row.updatedAt])),
			)
		).map(toSocialItem);
	}

	private async requireVideoItem(itemId: string, allowedTypes = VIDEO_TYPES): Promise<void> {
		const item = await this.dataSource.getRepository(MediaItem).findOne({
			where: { id: itemId, isPlaceholder: false },
			select: { id: true, type: true },
		});
		if (!item) throw new NotFound("Media item not found.");
		if (!allowedTypes.includes(item.type)) throw new BadRequest("Only video items of a supported type can be added here.");
	}

	private async ownedCollection(userId: string, id: string): Promise<VideoCollection> {
		const collection = await this.dataSource.getRepository(VideoCollection).findOneBy({ id, userId });
		if (!collection) throw new NotFound("Collection not found.");
		return collection;
	}

	/** Row lock on the user serialises concurrent queue changes; the query builder avoids the eager preferences join, which cannot be locked. */
	private async lockUser(manager: EntityManager, userId: string): Promise<void> {
		await manager.createQueryBuilder(User, "user").select("user.id").setLock("pessimistic_write").where("user.id = :userId", { userId }).getOne();
	}

	private async ownerVisible(viewerId: string, ownerId: string): Promise<boolean> {
		const preferences = await this.dataSource.getRepository(UserPreference).findOne({ select: { profileVisibility: true }, where: { userId: ownerId } });
		const visibility = preferences?.profileVisibility ?? "public";
		if (visibility === "public" || viewerId === ownerId) return true;
		if (visibility === "hidden") return false;
		return this.dataSource.getRepository(SocialFriendship).existsBy([
			{ userLowId: viewerId, userHighId: ownerId, acceptedAt: Not(IsNull()) },
			{ userLowId: ownerId, userHighId: viewerId, acceptedAt: Not(IsNull()) },
		]);
	}

	private collectionRows<T extends CollectionRow & { item_count: number }>(rows: T[]) {
		return rows.map((row) => ({
			id: row.id,
			name: row.name,
			description: row.description,
			isPublic: row.is_public,
			itemCount: row.item_count,
			createdAt: row.created_at,
			updatedAt: row.updated_at,
		}));
	}

	private cleanDescription(value: string | null | undefined): string | null {
		const text = value?.trim().slice(0, 500) ?? "";
		return text || null;
	}
}
