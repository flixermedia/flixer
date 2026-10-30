import { Inject, Injectable, logger } from "@tsed/di";
import { BadRequest, NotFound } from "@tsed/exceptions";
import { DataSource, In } from "typeorm";
import { DefaultDataSource } from "../../datasources/defaultDataSource.datasource.js";
import { MediaItem } from "../../entities/mediaItem.entity.js";
import { Setting } from "../../entities/setting.entity.js";
import { appConfig } from "../../config/store/appConfig.js";

const INDEX_UID = "media";
const SEARCH_DOCUMENT_VERSION = 2;
const SEARCH_DOCUMENT_VERSION_SETTING = "media_search_document_version";
const LEGACY_VECTOR_SEARCH_SETTINGS = [
	"media_search_vector_enabled",
	"media_search_semantic_ratio",
	"media_search_include_lyrics",
];
export const MEDIA_SEARCH_ENABLED_SETTING = "media_search_enabled";
export const MEDIA_SEARCH_URL_SETTING = "media_search_url";
const OUTBOX_BATCH_SIZE = 100;
const REBUILD_PAGE_SIZE = 500;
const MAX_TRACK_LYRICS_LENGTH = 2 << 20;
const POLL_INTERVAL_MS = 3_000;
const INITIAL_INDEX_CHECK_INTERVAL_MS = 60_000;

export interface MediaSearchFilters {
	type?: string | string[];
	genre?: string;
	yearFrom?: number;
	yearTo?: number;
	sort?: string;
}

interface SearchDocument {
	id: string;
	type: string;
	title: string;
	sortTitle: string;
	parentTitle: string;
	childTitles: string[];
	artist: string[];
	credits: string[];
	studios: string[];
	description: string;
	lyrics: string;
	year: number | null;
	genres: string[];
	createdAt: Date | string;
}

interface OutboxEvent {
	event_id: string;
	item_id: string | null;
	operation: "upsert" | "delete" | "rebuild" | "reset";
	document: SearchDocument | string | null;
}

interface MeilisearchTask {
	taskUid?: number;
	uid?: number;
}

interface MeilisearchIndex {
	uid?: string;
}

interface MeilisearchSearchResponse {
	hits?: Array<{ id?: string }>;
}

interface MeilisearchTaskSummary {
	uid: number;
	indexUid: string | null;
	status: string;
	type: string;
	enqueuedAt: string;
	startedAt: string | null;
	finishedAt: string | null;
	duration: string | null;
	error: { message?: string } | null;
}

interface MeilisearchTasksResponse {
	results?: MeilisearchTaskSummary[];
}

export interface MediaSearchTaskDetails extends MeilisearchTaskSummary {
	details: Record<string, unknown> | null;
	error: {
		message?: string;
		code?: string;
		type?: string;
		link?: string;
	} | null;
}

export interface MediaSearchAdminStatus {
	enabled: boolean;
	url: string;
	customUrl: string;
	urlSource: "database" | "environment" | "default";
	apiKeyConfigured: boolean;
	connected: boolean | null;
	indexExists: boolean | null;
	documentCount: number | null;
	outboxPending: number;
	outboxFailed: number;
	lastOutboxError: string | null;
	tasks: MeilisearchTaskSummary[];
	tasksError: string | null;
	error: string | null;
}

function strings(value: unknown): string[] {
	return Array.isArray(value)
		? value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
		: [];
}

function values(value: unknown): string[] {
	if (typeof value === "string") return value.trim() ? [value.trim()] : [];
	if (!Array.isArray(value)) return [];
	return value.flatMap((entry) => {
		if (typeof entry === "string") return entry.trim() ? [entry.trim()] : [];
		if (typeof entry !== "object" || entry === null) return [];
		const person = entry as Record<string, unknown>;
		return [person.name, person.type, person.role, person.character, person.job, person.department].filter(
			(value): value is string => typeof value === "string" && value.trim().length > 0,
		);
	});
}

function unique(values_: string[]): string[] {
	return [...new Set(values_.map((value) => value.trim()).filter(Boolean))];
}

interface SearchDocumentContext {
	parent?: MediaItem;
	series?: MediaItem;
	childTitles?: string[];
	childArtists?: string[];
	lyrics?: string;
}

function searchDocument(item: MediaItem, context: SearchDocumentContext = {}): SearchDocument {
	const metadata = item.metadata ?? {};
	const parentTitle = item.type === "episode" ? (context.series?.title ?? "") : (context.parent?.title ?? "");
	const ownCredits = [...values(metadata.cast), ...values(metadata.crew)];
	const ownStudios = strings(metadata.studios);
	const description = unique(
		[metadata.overview, metadata.tagline].flatMap((value) =>
			typeof value === "string" && value.trim() ? [value.trim()] : [],
		),
	).join(" ");
	const artists = unique([
		...values(metadata.artist),
		...values(metadata.albumArtist),
		...(item.type === "album" ? (context.childArtists ?? []) : []),
		...(item.type === "track" ? values(context.parent?.metadata?.artist) : []),
		...(item.type === "track" ? values(context.parent?.metadata?.albumArtist) : []),
	]);
	const credits =
		item.type === "movie" || item.type === "series" || item.type === "episode" ? unique(ownCredits) : [];
	return {
		id: item.id,
		type: item.type,
		title: item.title,
		sortTitle: item.sortTitle ?? item.title,
		parentTitle,
		childTitles: context.childTitles ?? [],
		artist: item.type === "album" || item.type === "track" ? artists : [],
		credits,
		studios:
			item.type === "movie" || item.type === "series" || item.type === "episode" || item.type === "video"
				? unique(ownStudios)
				: [],
		description:
			item.type === "movie" ||
			item.type === "series" ||
			item.type === "episode" ||
			item.type === "album" ||
			item.type === "track" ||
			item.type === "video"
				? description
				: "",
		lyrics: item.type === "track" ? (context.lyrics ?? "") : "",
		year: item.year ?? context.parent?.year ?? context.series?.year ?? null,
		genres: unique([
			...strings(metadata.genres),
			...strings(context.parent?.metadata?.genres),
			...strings(context.series?.metadata?.genres),
		]),
		createdAt: item.createdAt,
	};
}

function quoteFilter(value: string): string {
	return JSON.stringify(value);
}

/** Keeps a rebuildable Meilisearch index current through a PostgreSQL transactional outbox. */
@Injectable()
export class MediaSearchService {
	private baseUrl = (process.env.MEILISEARCH_URL || "http://localhost:7700").replace(/\/+$/, "");
	private customUrl = "";
	private urlSource: MediaSearchAdminStatus["urlSource"] = process.env.MEILISEARCH_URL ? "environment" : "default";
	private enabled = true;
	private settingsLoaded = false;
	private settingsLoadPromise: Promise<void> | undefined;
	private timer: NodeJS.Timeout | undefined;
	private ready = false;
	private rebuildPending = false;
	private setupPromise: Promise<void> | undefined;
	private processing = false;
	private lastWarningAt = 0;
	private lastInitialIndexCheckAt = 0;

	constructor(@Inject(DefaultDataSource) private readonly dataSource: DataSource) {}

	private get apiKey(): string {
		return process.env.MEILISEARCH_API_KEY?.trim() || appConfig().get("appSecret")?.trim() || "";
	}

	$onInit(): void {
		this.timer = setInterval(() => void this.processOutbox(), POLL_INTERVAL_MS);
		this.timer.unref();
		void this.loadAdminSettings()
			.then(() => this.processOutbox())
			.catch((error: unknown) => this.warn("Meilisearch settings could not be loaded.", error));
	}

	$onDestroy(): void {
		if (this.timer) clearInterval(this.timer);
		this.timer = undefined;
	}

	async searchIds(query: string, filters: MediaSearchFilters = {}): Promise<string[] | null> {
		try {
			await this.ensureAdminSettingsLoaded();
			if (!this.enabled) return null;
			await this.ensureIndex();
			if (this.rebuildPending) return null;
			const filter: string[] = [];
			if (filters.type) {
				const types = (Array.isArray(filters.type) ? filters.type : [filters.type]).filter(Boolean);
				if (types.length === 1) filter.push(`type = ${quoteFilter(types[0])}`);
				if (types.length > 1)
					filter.push(`(${types.map((type) => `type = ${quoteFilter(type)}`).join(" OR ")})`);
			}
			if (filters.genre) filter.push(`genres = ${quoteFilter(filters.genre)}`);
			if (Number.isInteger(filters.yearFrom)) filter.push(`year >= ${filters.yearFrom}`);
			if (Number.isInteger(filters.yearTo)) filter.push(`year <= ${filters.yearTo}`);

			const sort =
				filters.sort === "title"
					? ["sortTitle:asc"]
					: filters.sort === "year"
						? ["year:desc", "title:asc"]
						: filters.sort === "added"
							? ["createdAt:desc"]
							: query
								? undefined
								: ["title:asc"];
			const response = await this.request<MeilisearchSearchResponse>(`/indexes/${INDEX_UID}/search`, {
				method: "POST",
				body: JSON.stringify({
					q: query,
					filter: filter.length > 0 ? filter.join(" AND ") : undefined,
					sort,
					limit: 1000,
					attributesToRetrieve: ["id"],
				}),
			});
			return (response.hits ?? []).flatMap((hit) => (typeof hit.id === "string" ? [hit.id] : []));
		} catch (error) {
			this.ready = false;
			this.warn("Meilisearch search failed; PostgreSQL search will be used.", error);
			return null;
		}
	}

	async enqueueRebuild(): Promise<{ queued: boolean }> {
		const rows: Array<{ event_id: string }> = await this.dataSource.query(`
			INSERT INTO "media_search_outbox" ("operation")
			VALUES ('rebuild')
			ON CONFLICT ("operation") WHERE "operation" = 'rebuild' DO NOTHING
			RETURNING "event_id"
		`);
		this.rebuildPending = true;
		return { queued: rows.length > 0 };
	}

	async resetAndRebuild(): Promise<{ queued: boolean }> {
		await this.ensureAdminSettingsLoaded();
		if (!this.enabled) throw new BadRequest("Enable Meilisearch before resetting its media index.");
		const rows: Array<{ event_id: string }> = await this.dataSource.query(`
			INSERT INTO "media_search_outbox" ("operation")
			VALUES ('reset')
			ON CONFLICT ("operation") WHERE "operation" = 'reset' DO NOTHING
			RETURNING "event_id"
		`);
		this.rebuildPending = true;
		return { queued: rows.length > 0 };
	}

	async storeTrackLyrics(itemId: string, lyrics: string): Promise<void> {
		if (typeof lyrics !== "string" || Buffer.byteLength(lyrics, "utf8") > MAX_TRACK_LYRICS_LENGTH) {
			throw new BadRequest("Track lyrics are too long.");
		}
		const item = await this.dataSource.getRepository(MediaItem).findOne({
			where: { id: itemId, type: "track", isPlaceholder: false },
			select: { id: true },
		});
		if (!item) throw new NotFound("Track not found.");

		await this.dataSource.transaction(async (manager) => {
			if (lyrics.trim()) {
				await manager.query(
					`INSERT INTO "media_search_lyrics" ("item_id", "lyrics")
					VALUES ($1, $2)
					ON CONFLICT ("item_id") DO UPDATE SET "lyrics" = EXCLUDED."lyrics", "updated_at" = now()`,
					[itemId, lyrics],
				);
			} else {
				await manager.query(`DELETE FROM "media_search_lyrics" WHERE "item_id" = $1`, [itemId]);
			}
			await manager.query(`INSERT INTO "media_search_outbox" ("item_id", "operation") VALUES ($1, 'upsert')`, [
				itemId,
			]);
		});
	}

	async getAdminTask(uid: number): Promise<MediaSearchTaskDetails> {
		if (!Number.isSafeInteger(uid) || uid < 0) {
			throw new BadRequest("Meilisearch task id must be a non-negative integer.");
		}
		await this.ensureAdminSettingsLoaded();
		if (!this.enabled) throw new NotFound("Meilisearch is disabled.");
		const task = await this.request<MediaSearchTaskDetails | null>(`/tasks/${uid}`, {}, [404]);
		if (!task || task.uid !== uid || task.indexUid !== INDEX_UID) {
			throw new NotFound("Meilisearch task not found.");
		}
		return task;
	}

	async getAdminStatus(): Promise<MediaSearchAdminStatus> {
		await this.loadAdminSettings();
		const outboxRows: Array<{ pending: number | string; failed: number | string; last_error: string | null }> =
			await this.dataSource.query(`
				SELECT
					COUNT(*) FILTER (WHERE "last_error" IS NULL)::int AS pending,
					COUNT(*) FILTER (WHERE "last_error" IS NOT NULL)::int AS failed,
					(SELECT "last_error" FROM "media_search_outbox" WHERE "last_error" IS NOT NULL ORDER BY "event_id" DESC LIMIT 1) AS last_error
				FROM "media_search_outbox"
			`);
		const outbox = outboxRows[0];
		const status: MediaSearchAdminStatus = {
			enabled: this.enabled,
			url: this.displayUrl,
			customUrl: this.customUrl,
			urlSource: this.urlSource,
			apiKeyConfigured: Boolean(this.apiKey),
			connected: null,
			indexExists: null,
			documentCount: null,
			outboxPending: Number(outbox?.pending ?? 0),
			outboxFailed: Number(outbox?.failed ?? 0),
			lastOutboxError: outbox?.last_error ?? null,
			tasks: [],
			tasksError: null,
			error: null,
		};
		if (!this.enabled) return status;

		try {
			await this.request("/health");
			status.connected = true;
			const indexStats = await this.request<{ numberOfDocuments?: number }>(
				`/indexes/${INDEX_UID}/stats`,
				{},
				[404],
			);
			status.indexExists = typeof indexStats.numberOfDocuments === "number";
			status.documentCount = status.indexExists ? (indexStats.numberOfDocuments ?? 0) : null;
			if (status.indexExists) {
				try {
					const query = new URLSearchParams({ indexUids: INDEX_UID, limit: "10" });
					const tasks = await this.request<MeilisearchTasksResponse>(`/tasks?${query}`);
					status.tasks = Array.isArray(tasks.results) ? tasks.results : [];
				} catch (error) {
					status.tasksError = error instanceof Error ? error.message : String(error);
				}
			}
		} catch (error) {
			status.connected = false;
			status.error = error instanceof Error ? error.message : String(error);
		}
		return status;
	}

	private get displayUrl(): string {
		try {
			const url = new URL(this.baseUrl);
			url.username = "";
			url.password = "";
			url.search = "";
			url.hash = "";
			return url.toString().replace(/\/+$/, "");
		} catch {
			return "";
		}
	}

	async saveAdminSettings(input: { enabled: boolean; url: string }): Promise<MediaSearchAdminStatus> {
		if (typeof input.enabled !== "boolean" || typeof input.url !== "string" || input.url.length > 2048) {
			throw new BadRequest("Meilisearch settings are invalid.");
		}
		const customUrl = this.validateCustomUrl(input.url);
		await this.ensureAdminSettingsLoaded();
		const previousEnabled = this.enabled;
		const previousUrl = this.baseUrl;
		const repository = this.dataSource.getRepository(Setting);
		const settingsToSave: Array<[string, unknown]> = [
			[MEDIA_SEARCH_ENABLED_SETTING, input.enabled],
			[MEDIA_SEARCH_URL_SETTING, customUrl],
		];
		for (const [key, value] of settingsToSave) {
			const setting = await repository.findOneBy({ key });
			if (setting) {
				setting.value = value;
				await repository.save(setting);
			} else {
				await repository.save({ key, value, isPublic: false });
			}
		}
		await this.loadAdminSettings();
		if (this.enabled && (!previousEnabled || previousUrl !== this.baseUrl)) {
			this.ready = false;
			await this.enqueueRebuild();
		}
		return this.getAdminStatus();
	}

	private validateCustomUrl(value: string): string {
		const trimmed = value.trim();
		if (!trimmed) return "";
		try {
			const url = new URL(trimmed);
			if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
				throw new Error("unsupported URL");
			}
			return url.toString().replace(/\/+$/, "");
		} catch {
			throw new BadRequest(
				"Meilisearch URL must be a valid HTTP or HTTPS URL without credentials or query parameters.",
			);
		}
	}

	private async loadAdminSettings(): Promise<void> {
		const settings = await this.dataSource.getRepository(Setting).findBy({
			key: In([MEDIA_SEARCH_ENABLED_SETTING, MEDIA_SEARCH_URL_SETTING]),
		});
		const enabled = settings.find((setting) => setting.key === MEDIA_SEARCH_ENABLED_SETTING)?.value;
		const url = settings.find((setting) => setting.key === MEDIA_SEARCH_URL_SETTING)?.value;
		this.enabled = typeof enabled === "boolean" ? enabled : true;
		this.customUrl = typeof url === "string" ? url : "";
		const environmentUrl = process.env.MEILISEARCH_URL?.trim();
		this.baseUrl = (this.customUrl || environmentUrl || "http://localhost:7700").replace(/\/+$/, "");
		this.urlSource = this.customUrl ? "database" : environmentUrl ? "environment" : "default";
		this.settingsLoaded = true;
	}

	private async ensureAdminSettingsLoaded(): Promise<void> {
		if (this.settingsLoaded) return;
		if (!this.settingsLoadPromise) {
			this.settingsLoadPromise = this.loadAdminSettings().finally(() => {
				this.settingsLoadPromise = undefined;
			});
		}
		await this.settingsLoadPromise;
	}

	private async ensureIndex(): Promise<void> {
		if (this.ready) return;
		if (this.setupPromise) return this.setupPromise;
		this.setupPromise = this.createIndex().finally(() => {
			this.setupPromise = undefined;
		});
		return this.setupPromise;
	}

	private async createIndex(): Promise<void> {
		const index = await this.request<MeilisearchIndex>(`/indexes/${INDEX_UID}`, {}, [404]);
		const documentVersions: Array<{ value: number }> = await this.dataSource.query(
			'SELECT "value" FROM "settings" WHERE "key" = $1',
			[SEARCH_DOCUMENT_VERSION_SETTING],
		);
		const pendingMaintenance: Array<{ operation: "rebuild" | "reset" }> = await this.dataSource.query(`
			SELECT "operation"
			FROM "media_search_outbox"
			WHERE "operation" IN ('rebuild', 'reset')
			ORDER BY "event_id"
			LIMIT 1
		`);
		const needsRebuild = documentVersions[0]?.value !== SEARCH_DOCUMENT_VERSION;
		if (index.uid === INDEX_UID && needsRebuild) {
			const deleted = await this.request<MeilisearchTask>(`/indexes/${INDEX_UID}`, { method: "DELETE" });
			if (deleted.taskUid !== undefined) await this.waitForTask(deleted.taskUid);
		}
		if (needsRebuild || pendingMaintenance.length > 0) this.rebuildPending = true;
		if (index.uid !== INDEX_UID || needsRebuild) {
			const created = await this.request<MeilisearchTask>(
				"/indexes",
				{ method: "POST", body: JSON.stringify({ uid: INDEX_UID, primaryKey: "id" }) },
				[409],
			);
			if (created.taskUid !== undefined) await this.waitForTask(created.taskUid);
		}
		await this.configureIndex();
		if (needsRebuild) await this.enqueueRebuild();
		await this.dataSource.query('DELETE FROM "settings" WHERE "key" = ANY($1::varchar[])', [
			LEGACY_VECTOR_SEARCH_SETTINGS,
		]);
		this.ready = true;
	}

	private async configureIndex(): Promise<void> {
		const settingsTask = await this.request<MeilisearchTask>(`/indexes/${INDEX_UID}/settings`, {
			method: "PATCH",
			body: JSON.stringify({
				searchableAttributes: [
					"title",
					"parentTitle",
					"childTitles",
					"artist",
					"credits",
					"studios",
					"description",
					"lyrics",
				],
				filterableAttributes: ["type", "year", "genres"],
				sortableAttributes: ["sortTitle", "year", "title", "createdAt"],
				displayedAttributes: ["id"],
			}),
		});
		if (settingsTask.taskUid !== undefined) await this.waitForTask(settingsTask.taskUid);
	}

	private async processOutbox(): Promise<void> {
		if (this.processing) return;
		this.processing = true;
		try {
			await this.ensureAdminSettingsLoaded();
			if (!this.enabled) return;
			await this.ensureIndex();
			await this.ensureInitialIndex();
			const events = await this.claimEvents();
			if (events.length === 0) return;
			try {
				const maintenanceIndex = events.findIndex(
					(event) => event.operation === "rebuild" || event.operation === "reset",
				);
				const documentEvents = maintenanceIndex < 0 ? events : events.slice(0, maintenanceIndex);
				if (documentEvents.length > 0) await this.applyDocumentEvents(documentEvents);
				if (maintenanceIndex >= 0) {
					this.rebuildPending = true;
					const maintenanceEvent = events[maintenanceIndex];
					if (maintenanceEvent.operation === "reset") {
						await this.resetIndex();
					} else {
						await this.rebuildIndex();
					}
				}
				await this.dataSource.query(`DELETE FROM "media_search_outbox" WHERE "event_id" = ANY($1::bigint[])`, [
					events.map((event) => event.event_id),
				]);
			} catch (error) {
				await this.dataSource.query(
					`UPDATE "media_search_outbox"
					SET "locked_until" = NULL, "next_attempt_at" = now() + interval '30 seconds', "last_error" = $2
					WHERE "event_id" = ANY($1::bigint[])`,
					[
						events.map((event) => event.event_id),
						error instanceof Error ? error.message.slice(0, 2000) : String(error),
					],
				);
				throw error;
			}
		} catch (error) {
			this.ready = false;
			this.warn("Meilisearch outbox processing failed; events will be retried.", error);
		} finally {
			this.processing = false;
		}
	}

	private async ensureInitialIndex(): Promise<void> {
		const now = Date.now();
		if (now - this.lastInitialIndexCheckAt < INITIAL_INDEX_CHECK_INTERVAL_MS) return;
		this.lastInitialIndexCheckAt = now;
		const indexed = await this.request<{ numberOfDocuments?: number }>(`/indexes/${INDEX_UID}/stats`);
		if ((indexed.numberOfDocuments ?? 0) > 0) return;
		const mediaCount = await this.dataSource.getRepository(MediaItem).count({ where: { isPlaceholder: false } });
		if (mediaCount > 0) await this.enqueueRebuild();
	}

	private async claimEvents(): Promise<OutboxEvent[]> {
		return this.dataSource.transaction(async (manager) => {
			const rows: OutboxEvent[] = await manager.query(
				`SELECT "event_id", "item_id", "operation", "document"
				FROM "media_search_outbox"
				WHERE "next_attempt_at" <= now() AND ("locked_until" IS NULL OR "locked_until" < now())
				ORDER BY "event_id"
				LIMIT $1
				FOR UPDATE SKIP LOCKED`,
				[OUTBOX_BATCH_SIZE],
			);
			if (rows.length === 0) return [];
			const maintenanceIndex = rows.findIndex(
				(event) => event.operation === "rebuild" || event.operation === "reset",
			);
			const claimed = maintenanceIndex < 0 ? rows : rows.slice(0, maintenanceIndex + 1);
			await manager.query(
				`UPDATE "media_search_outbox"
				SET "locked_until" = now() + interval '30 minutes', "attempts" = "attempts" + 1
				WHERE "event_id" = ANY($1::bigint[])`,
				[claimed.map((event) => event.event_id)],
			);
			return claimed;
		});
	}

	private async applyDocumentEvents(events: OutboxEvent[]): Promise<void> {
		const latest = new Map<string, OutboxEvent>();
		for (const event of events) {
			if (event.item_id) latest.set(event.item_id, event);
		}
		const upsertIds: string[] = [];
		const deletes: string[] = [];
		for (const [id, event] of latest) {
			if (event.operation === "delete") {
				deletes.push(id);
			} else if (event.operation === "upsert") {
				upsertIds.push(id);
			}
		}
		const deletedSet = new Set(deletes);
		const documents = (await this.searchDocumentsFor(upsertIds)).filter((document) => !deletedSet.has(document.id));
		if (documents.length > 0) {
			const task = await this.request<MeilisearchTask>(`/indexes/${INDEX_UID}/documents?primaryKey=id`, {
				method: "POST",
				body: JSON.stringify(documents),
			});
			if (task.taskUid !== undefined) await this.waitForTask(task.taskUid);
		}
		if (deletes.length > 0) {
			const task = await this.request<MeilisearchTask>(`/indexes/${INDEX_UID}/documents/delete-batch`, {
				method: "POST",
				body: JSON.stringify({ ids: deletes }),
			});
			if (task.taskUid !== undefined) await this.waitForTask(task.taskUid);
		}
	}

	private async searchDocumentsFor(itemIds: string[], includeRelated = true): Promise<SearchDocument[]> {
		if (itemIds.length === 0) return [];
		const targetIds = new Set(itemIds);
		const relatedRows: Array<{ id: string }> = await this.dataSource.query(
			`WITH RECURSIVE ancestors("id", "depth") AS (
				SELECT unnest($1::uuid[]), 0
				UNION ALL
				SELECT parent."id", ancestors."depth" + 1
				FROM ancestors
				JOIN "media_items" item ON item."id" = ancestors."id"
				JOIN "media_items" parent ON parent."id" = item."parent_id"
				WHERE ancestors."depth" < 2
			),
			related("id", "depth") AS (
				SELECT "id", 0 FROM ancestors
				UNION ALL
				SELECT child."id", related."depth" + 1
				FROM related
				JOIN "media_items" child ON child."parent_id" = related."id"
				WHERE related."depth" < 2 AND child."is_placeholder" = false
			)
			SELECT DISTINCT "id" FROM related`,
			[itemIds],
		);
		const relatedIds = relatedRows.map((row) => row.id);
		if (relatedIds.length === 0) return [];
		const items = await this.dataSource.getRepository(MediaItem).find({ where: { id: In(relatedIds) } });
		const byId = new Map(items.map((item) => [item.id, item]));
		const trackIds = items.filter((item) => item.type === "track").map((item) => item.id);
		const lyricRows: Array<{ item_id: string; lyrics: string }> =
			trackIds.length > 0
				? await this.dataSource.query(
						`SELECT "item_id", "lyrics" FROM "media_search_lyrics" WHERE "item_id" = ANY($1::uuid[])`,
						[trackIds],
					)
				: [];
		const lyricsById = new Map(lyricRows.map((row) => [row.item_id, row.lyrics]));
		const seriesFor = (item: MediaItem): MediaItem | undefined => {
			let parent = item.parentId ? byId.get(item.parentId) : undefined;
			while (parent && parent.type !== "series") {
				parent = parent.parentId ? byId.get(parent.parentId) : undefined;
			}
			return parent;
		};
		const documents: SearchDocument[] = [];
		for (const item of items) {
			if (item.isPlaceholder || item.type === "season") continue;
			if (!includeRelated && !targetIds.has(item.id)) continue;
			const parent = item.parentId ? byId.get(item.parentId) : undefined;
			const series = item.type === "episode" ? seriesFor(item) : undefined;
			const children =
				item.type === "album"
					? items.filter((child) => child.type === "track" && child.parentId === item.id)
					: item.type === "series"
						? items.filter((child) => child.type === "episode" && seriesFor(child)?.id === item.id)
						: [];
			documents.push(
				searchDocument(item, {
					parent,
					series,
					childTitles: children.map((child) => child.title),
					childArtists: children.flatMap((child) => [
						...values(child.metadata?.artist),
						...values(child.metadata?.albumArtist),
					]),
					lyrics: lyricsById.get(item.id),
				}),
			);
		}
		return documents;
	}

	private async rebuildIndex(): Promise<void> {
		this.rebuildPending = true;
		const deleted = await this.request<MeilisearchTask>(`/indexes/${INDEX_UID}/documents`, { method: "DELETE" });
		if (deleted.taskUid !== undefined) await this.waitForTask(deleted.taskUid);

		let afterId = "";
		while (true) {
			const builder = this.dataSource
				.getRepository(MediaItem)
				.createQueryBuilder("item")
				.select([
					"item.id",
					"item.type",
					"item.title",
					"item.sortTitle",
					"item.year",
					"item.metadata",
					"item.createdAt",
				])
				.where("item.is_placeholder = false")
				.orderBy("item.id", "ASC")
				.take(REBUILD_PAGE_SIZE);
			if (afterId) builder.andWhere("item.id > :afterId", { afterId });
			const items = await builder.getMany();
			if (items.length === 0) break;
			const documents = await this.searchDocumentsFor(
				items.map((item) => item.id),
				false,
			);
			const task = await this.request<MeilisearchTask>(`/indexes/${INDEX_UID}/documents?primaryKey=id`, {
				method: "POST",
				body: JSON.stringify(documents),
			});
			if (task.taskUid !== undefined) await this.waitForTask(task.taskUid);
			afterId = items[items.length - 1].id;
		}
		logger().info("Rebuilt the Meilisearch media index.");
		await this.dataSource.query('DELETE FROM "settings" WHERE "key" = ANY($1::varchar[])', [
			LEGACY_VECTOR_SEARCH_SETTINGS,
		]);
		await this.dataSource.query(
			`INSERT INTO "settings" ("key", "value", "is_public")
			VALUES ($1, $2::jsonb, false)
			ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value", "is_public" = false`,
			[SEARCH_DOCUMENT_VERSION_SETTING, JSON.stringify(SEARCH_DOCUMENT_VERSION)],
		);
		this.rebuildPending = false;
	}

	private async resetIndex(): Promise<void> {
		const deleted = await this.request<MeilisearchTask>(`/indexes/${INDEX_UID}`, { method: "DELETE" }, [404]);
		if (deleted.taskUid !== undefined) await this.waitForTask(deleted.taskUid);
		const created = await this.request<MeilisearchTask>(
			"/indexes",
			{ method: "POST", body: JSON.stringify({ uid: INDEX_UID, primaryKey: "id" }) },
			[409],
		);
		if (created.taskUid !== undefined) await this.waitForTask(created.taskUid);
		await this.configureIndex();
		await this.rebuildIndex();
	}

	private async waitForTask(uid: number, timeoutMs = 120_000): Promise<void> {
		const deadline = Date.now() + timeoutMs;
		while (Date.now() < deadline) {
			const task = await this.request<{ status?: string; error?: { message?: string } }>(`/tasks/${uid}`);
			if (task.status === "succeeded") return;
			if (task.status === "failed" || task.status === "canceled") {
				throw new Error(task.error?.message ?? `Meilisearch task ${uid} ${task.status}.`);
			}
			await new Promise((resolve) => setTimeout(resolve, 250));
		}
		throw new Error(`Meilisearch task ${uid} timed out.`);
	}

	private async request<T>(path: string, init: RequestInit = {}, acceptedStatuses: number[] = []): Promise<T> {
		const headers = new Headers(init.headers);
		if (init.body !== undefined) headers.set("Content-Type", "application/json");
		if (this.apiKey) headers.set("Authorization", `Bearer ${this.apiKey}`);
		const response = await fetch(`${this.baseUrl}${path}`, {
			...init,
			headers,
			signal: AbortSignal.timeout(10_000),
		});
		const raw = await response.text();
		let body: unknown;
		try {
			body = raw ? JSON.parse(raw) : {};
		} catch {
			body = raw;
		}
		if (!response.ok && !acceptedStatuses.includes(response.status)) {
			const message =
				typeof body === "object" && body !== null && "message" in body && typeof body.message === "string"
					? body.message
					: response.statusText;
			throw new Error(`Meilisearch ${init.method ?? "GET"} ${path} failed (${response.status}): ${message}`);
		}
		return body as T;
	}

	private warn(message: string, error: unknown): void {
		const now = Date.now();
		if (now - this.lastWarningAt < 60_000) return;
		this.lastWarningAt = now;
		logger().warn(message, error);
	}
}
