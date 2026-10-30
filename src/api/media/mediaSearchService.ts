import { Inject, Injectable, logger } from "@tsed/di";
import { DataSource } from "typeorm";
import { DefaultDataSource } from "../../datasources/defaultDataSource.datasource.js";
import { MediaItem } from "../../entities/mediaItem.entity.js";
import { appConfig } from "../../config/store/appConfig.js";

const INDEX_UID = "media";
const OUTBOX_BATCH_SIZE = 100;
const REBUILD_PAGE_SIZE = 500;
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
	year: number | null;
	genres: string[];
	searchText: string;
	createdAt: Date | string;
}

interface OutboxEvent {
	event_id: string;
	item_id: string | null;
	operation: "upsert" | "delete" | "rebuild";
	document: SearchDocument | string | null;
}

interface MeilisearchTask {
	taskUid?: number;
	uid?: number;
}

interface MeilisearchSearchResponse {
	hits?: Array<{ id?: string }>;
}

function strings(value: unknown): string[] {
	return Array.isArray(value)
		? value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
		: [];
}

function text(value: unknown): string {
	return typeof value === "string" ? value : "";
}

function searchDocument(item: MediaItem): SearchDocument {
	const metadata = item.metadata ?? {};
	const genres = strings(metadata.genres);
	const searchText = [
		item.title,
		item.sortTitle,
		metadata.overview,
		metadata.tagline,
		metadata.artist,
		metadata.albumArtist,
		metadata.cast,
		metadata.crew,
	]
		.map((value) =>
			typeof value === "string"
				? value
				: Array.isArray(value) || (typeof value === "object" && value !== null)
					? JSON.stringify(value)
					: "",
		)
		.filter(Boolean)
		.join(" ");
	return {
		id: item.id,
		type: item.type,
		title: item.title,
		sortTitle: item.sortTitle ?? item.title,
		year: item.year,
		genres,
		searchText,
		createdAt: item.createdAt,
	};
}

function quoteFilter(value: string): string {
	return JSON.stringify(value);
}

/** Keeps a rebuildable Meilisearch index current through a PostgreSQL transactional outbox. */
@Injectable()
export class MediaSearchService {
	private readonly baseUrl = (process.env.MEILISEARCH_URL || "http://localhost:7700").replace(/\/+$/, "");
	private timer: NodeJS.Timeout | undefined;
	private ready = false;
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
		void this.processOutbox();
	}

	$onDestroy(): void {
		if (this.timer) clearInterval(this.timer);
		this.timer = undefined;
	}

	async searchIds(query: string, filters: MediaSearchFilters = {}): Promise<string[] | null> {
		try {
			await this.ensureIndex();
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
		return { queued: rows.length > 0 };
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
		const created = await this.request<MeilisearchTask>(
			"/indexes",
			{ method: "POST", body: JSON.stringify({ uid: INDEX_UID, primaryKey: "id" }) },
			[409],
		);
		if (created.taskUid !== undefined) await this.waitForTask(created.taskUid);
		await this.request<MeilisearchTask>(`/indexes/${INDEX_UID}/settings`, {
			method: "PATCH",
			body: JSON.stringify({
				searchableAttributes: ["title", "sortTitle", "searchText"],
				filterableAttributes: ["type", "year", "genres"],
				sortableAttributes: ["sortTitle", "year", "title", "createdAt"],
				displayedAttributes: ["id"],
			}),
		}).then((task) => (task.taskUid === undefined ? undefined : this.waitForTask(task.taskUid)));
		this.ready = true;
	}

	private async processOutbox(): Promise<void> {
		if (this.processing) return;
		this.processing = true;
		try {
			await this.ensureIndex();
			await this.ensureInitialIndex();
			const events = await this.claimEvents();
			if (events.length === 0) return;
			try {
				const rebuildIndex = events.findIndex((event) => event.operation === "rebuild");
				const documentEvents = rebuildIndex < 0 ? events : events.slice(0, rebuildIndex);
				if (documentEvents.length > 0) await this.applyDocumentEvents(documentEvents);
				if (rebuildIndex >= 0) await this.rebuildIndex();
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
			const rebuildIndex = rows.findIndex((event) => event.operation === "rebuild");
			const claimed = rebuildIndex < 0 ? rows : rows.slice(0, rebuildIndex + 1);
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
		const documents: SearchDocument[] = [];
		const deletes: string[] = [];
		for (const [id, event] of latest) {
			if (event.operation === "delete") {
				deletes.push(id);
			} else if (event.operation === "upsert" && event.document) {
				documents.push(
					typeof event.document === "string"
						? (JSON.parse(event.document) as SearchDocument)
						: event.document,
				);
			}
		}
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

	private async rebuildIndex(): Promise<void> {
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
			const task = await this.request<MeilisearchTask>(`/indexes/${INDEX_UID}/documents?primaryKey=id`, {
				method: "POST",
				body: JSON.stringify(items.map(searchDocument)),
			});
			if (task.taskUid !== undefined) await this.waitForTask(task.taskUid);
			afterId = items[items.length - 1].id;
		}
		logger().info("Rebuilt the Meilisearch media index.");
	}

	private async waitForTask(uid: number): Promise<void> {
		const deadline = Date.now() + 120_000;
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
