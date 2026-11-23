// Runs the converted media search calls (lyrics, outbox) against a migrated throwaway schema:
//   ENTITY_SCHEMA_TEST_DATABASE_URL=postgres://... npx vitest run src/api/media/mediaSearchEntitiesPostgres.spec.ts
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { DataSource } from "typeorm";
import { MediaItem } from "../../entities/mediaItem.entity.js";
import { MediaLibrary } from "../../entities/mediaLibrary.entity.js";
import { MediaSearchLyrics, MediaSearchOutboxEvent } from "../../entities/mediaSearch.entity.js";
import { Setting } from "../../entities/setting.entity.js";
import { User } from "../../entities/user.entity.js";
import { WatchProgress } from "../../entities/watchProgress.entity.js";
import { MediaItemsService } from "../indexer/mediaItemsService.js";
import { ActivityService, mapActivityRow, type ActivityRow } from "../overview/activityService.js";
import { OverviewService } from "../overview/overviewService.js";
import { MediaHomeService } from "./mediaHomeService.js";
import { MEDIA_SEARCH_ENABLED_SETTING, MediaSearchService } from "./mediaSearchService.js";
import { HEAVY_HOOK_TIMEOUT, createIsolatedSchema, type IsolatedSchema } from "../../datasources/testPostgres.js";

const databaseUrl = process.env.ENTITY_SCHEMA_TEST_DATABASE_URL;

// RAW SQL: original activity projection retained as an equivalence oracle.
const ACTIVITY_SELECT = `COALESCE(u.display_name, u.username) AS user_name, i.title, i.type, parent.title AS parent_title,
	COALESCE(i.season_number, season.season_number) AS season_number, i.episode_number,
	w.position_seconds, w.duration_seconds, w.completed, w.updated_at`;
// RAW SQL: original activity joins retained as an equivalence oracle.
const ACTIVITY_FROM = `FROM watch_progress w
	JOIN users u ON u.id = w.user_id
	JOIN media_items i ON i.id = w.item_id
	LEFT JOIN media_items season ON season.id = i.parent_id AND i.type = 'episode'
	LEFT JOIN media_items parent ON parent.id = COALESCE(season.parent_id, i.parent_id)`;

describe.skipIf(!databaseUrl)("media search entities with PostgreSQL", () => {
	const library = randomUUID();
	const track = randomUUID();
	let isolated: IsolatedSchema;
	let db: DataSource;
	let service: MediaSearchService;

	const outbox = () => db.getRepository(MediaSearchOutboxEvent);

	beforeAll(async () => {
		isolated = await createIsolatedSchema(databaseUrl as string, { prefix: "media_search_entities_test" });
		db = isolated.db;
		await db.getRepository(MediaLibrary).save({ id: library, name: "Library", type: "mixed" });
		await db.getRepository(MediaItem).save({ id: track, libraryId: library, path: "/track", type: "track", title: "Track", externalKey: "track" });
		service = new MediaSearchService(db);
	}, HEAVY_HOOK_TIMEOUT);

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.unstubAllEnvs();
	});

	afterAll(async () => {
		await isolated?.drop();
	});

	it("stores, replaces and clears lyrics and queues the track each time", async () => {
		const queued = () => outbox().countBy({ itemId: track, operation: "upsert" });
		const before = await queued();
		await service.storeTrackLyrics(track, "first words");
		const first = await db.getRepository(MediaSearchLyrics).findOneByOrFail({ itemId: track });
		expect(first.lyrics).toBe("first words");
		expect(await queued()).toBe(before + 1);

		await service.storeTrackLyrics(track, "second words");
		const second = await db.getRepository(MediaSearchLyrics).findOneByOrFail({ itemId: track });
		expect(second.lyrics).toBe("second words");
		expect(second.updatedAt.getTime()).toBeGreaterThanOrEqual(first.updatedAt.getTime());
		expect(await queued()).toBe(before + 2);

		const documents = await (service as unknown as { searchDocumentsFor: (ids: string[]) => Promise<Array<{ id: string; lyrics?: string }>> }).searchDocumentsFor([track]);
		expect(documents.find((document) => document.id === track)).toMatchObject({ lyrics: "second words" });

		await service.storeTrackLyrics(track, "   ");
		expect(await db.getRepository(MediaSearchLyrics).countBy({ itemId: track })).toBe(0);
		expect(await queued()).toBe(before + 3);
		await expect(service.storeTrackLyrics(randomUUID(), "x")).rejects.toThrow("Track not found");
	});

	it("drains processed outbox events and keeps one pending rebuild or reset", async () => {
		await db.getRepository(Setting).save({ key: MEDIA_SEARCH_ENABLED_SETTING, value: true, isPublic: false });
		await db.getRepository(Setting).save([
			{ key: "media_search_document_version", value: 2, isPublic: false },
			{ key: "media_search_vector_enabled", value: true, isPublic: false },
			{ key: "media_search_semantic_ratio", value: 0.5, isPublic: false },
			{ key: "media_search_include_lyrics", value: true, isPublic: false },
		]);
		vi.stubEnv("MEILISEARCH_URL", "http://meili.test");
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response(JSON.stringify({ uid: "media", numberOfDocuments: 1, results: [] }), { status: 200, headers: { "Content-Type": "application/json" } })),
		);
		expect(await outbox().count()).toBeGreaterThan(0);
		await (service as unknown as { processOutbox: () => Promise<void> }).processOutbox();
		expect(await outbox().count()).toBe(0);
		expect(await db.getRepository(Setting).findOneBy({ key: "media_search_document_version" })).toMatchObject({ value: 2 });
		for (const key of ["media_search_vector_enabled", "media_search_semantic_ratio", "media_search_include_lyrics"]) {
			expect(await db.getRepository(Setting).findOneBy({ key })).toBeNull();
		}

		expect(await service.enqueueRebuild()).toEqual({ queued: true });
		expect(await service.enqueueRebuild()).toEqual({ queued: false });
		expect(await service.resetAndRebuild()).toEqual({ queued: true });
		expect(await service.resetAndRebuild()).toEqual({ queued: false });
		expect((await outbox().find({ order: { eventId: "ASC" } })).map((event) => event.operation)).toEqual(["rebuild", "reset"]);
	});

	it("marks only real episodes under a season or series as watched", async () => {
		const user = randomUUID();
		const series = randomUUID();
		const season = randomUUID();
		const episode = randomUUID();
		const placeholder = randomUUID();
		await db.getRepository(User).save({ id: user, username: "watched-test", passwordHash: "unused" });
		await db.getRepository(MediaItem).save([
			{ id: series, libraryId: library, path: "/series", type: "series", title: "Series", externalKey: "series" },
			{ id: season, libraryId: library, path: "/season", type: "season", title: "Season", externalKey: "season", parentId: series },
			{ id: episode, libraryId: library, path: "/episode", type: "episode", title: "Episode", externalKey: "episode", parentId: season },
			{ id: placeholder, libraryId: library, path: "/placeholder", type: "episode", title: "Placeholder", externalKey: "placeholder", parentId: season, isPlaceholder: true },
		]);
		const home = new MediaHomeService(db, {} as never, {} as never, {} as never);
		await home.setWatched(user, season, true);
		expect(await db.getRepository(WatchProgress).find({ where: { userId: user } })).toMatchObject([{ itemId: episode, completed: true }]);
		await home.setWatched(user, series, false);
		expect(await db.getRepository(WatchProgress).countBy({ userId: user })).toBe(0);
		await home.setWatched(user, series, true);
		expect(await db.getRepository(WatchProgress).find({ where: { userId: user } })).toMatchObject([{ itemId: episode, completed: true }]);
	});

	it("returns actual removal counts for indexed paths", async () => {
		const items = ["/remove/a", "/remove/b", "/remove/c"].map((path) => ({ id: randomUUID(), libraryId: library, path, type: "video" as const, title: path, externalKey: path }));
		await db.getRepository(MediaItem).save(items);
		const indexer = new MediaItemsService(db, {} as never);
		expect(await indexer.removePaths(library, [{ path: "/missing", recursive: false }])).toEqual({ removed: 0 });
		expect(await indexer.removePaths(library, [{ path: "/remove/a", recursive: false }])).toEqual({ removed: 1 });
		expect(await indexer.removePaths(library, [{ path: "/remove", recursive: true }])).toEqual({ removed: 2 });
	});

	it("matches the original overview aggregates", async () => {
		const emptyLibrary = randomUUID();
		await db.getRepository(MediaLibrary).save({ id: emptyLibrary, name: "Empty", type: "mixed" });
		await db.getRepository(MediaItem).save({ id: randomUUID(), libraryId: library, path: "/sized", type: "video", title: "Sized", externalKey: "sized", sizeBytes: 123 });
		const overview = new OverviewService(db, {} as never, {} as never, {} as never) as unknown as { counts: () => Promise<Record<string, number>>; libraries: () => Promise<Array<{ id: string; items: number; sizeBytes: number }>> };
		// RAW SQL: compare the TypeORM aggregates against the original PostgreSQL query.
		const counts = (await db.query("SELECT type, COUNT(*)::text AS count FROM media_items WHERE is_placeholder = false GROUP BY type")) as Array<{ type: string; count: string }>;
		const byType = new Map(counts.map((row) => [row.type, Number(row.count)]));
		expect(await overview.counts()).toEqual({ movies: byType.get("movie") ?? 0, series: byType.get("series") ?? 0, episodes: byType.get("episode") ?? 0, albums: byType.get("album") ?? 0, tracks: byType.get("track") ?? 0 });
		// RAW SQL: compare grouped nullable size and file-type filters with the original query.
		const totals = (await db.query("SELECT library_id, COUNT(*)::text AS items, SUM(size_bytes)::text AS size FROM media_items WHERE is_placeholder = false AND type = ANY($1) GROUP BY library_id", [["movie", "episode", "track", "video"]])) as Array<{ library_id: string; items: string; size: string | null }>;
		const byLibrary = new Map(totals.map((row) => [row.library_id, row]));
		for (const result of await overview.libraries()) {
			const original = byLibrary.get(result.id);
			expect(result).toMatchObject({ items: Number(original?.items ?? 0), sizeBytes: Number(original?.size ?? 0) });
		}
	});

	it("matches the original overview activity join", async () => {
		const overview = new OverviewService(db, {} as never, {} as never, {} as never) as unknown as { activity: () => Promise<ReturnType<typeof mapActivityRow>[]> };
		// RAW SQL: compare the TypeORM activity feed against the original shared join.
		const rows = (await db.query(`SELECT ${ACTIVITY_SELECT} ${ACTIVITY_FROM} ORDER BY w.updated_at DESC LIMIT $1`, [10])) as ActivityRow[];
		expect(rows.length).toBeGreaterThan(0);
		expect(await overview.activity()).toEqual(rows.map(mapActivityRow));
	});

	it("matches original activity filters, summaries, ordering and pagination", async () => {
		const activity = new ActivityService(db);
		const cases = [
			{ query: {}, clause: "", params: [] as unknown[], order: "w.updated_at DESC", pageSize: 25, offset: 0 },
			{ query: { search: "watched", status: "finished", type: "episode", sort: "title", pageSize: "1" }, clause: "WHERE (i.title ILIKE $1 ESCAPE '\\' OR parent.title ILIKE $1 ESCAPE '\\' OR u.username ILIKE $1 ESCAPE '\\' OR u.display_name ILIKE $1 ESCAPE '\\') AND i.type = $2 AND w.completed = true", params: ["%watched%", "episode"], order: "i.title ASC, w.updated_at DESC", pageSize: 1, offset: 0 },
			{ query: { from: "2020-01-01", to: "2099-12-31", sort: "user", page: "2", pageSize: "1" }, clause: "WHERE w.updated_at >= $1::date AND w.updated_at < ($2::date + 1)", params: ["2020-01-01", "2099-12-31"], order: "user_name ASC, w.updated_at DESC", pageSize: 1, offset: 1 },
			{ query: { search: "%_", status: "in_progress", sort: "oldest" }, clause: "WHERE (i.title ILIKE $1 ESCAPE '\\' OR parent.title ILIKE $1 ESCAPE '\\' OR u.username ILIKE $1 ESCAPE '\\' OR u.display_name ILIKE $1 ESCAPE '\\') AND w.completed = false", params: ["%\\%\\_%"], order: "w.updated_at ASC", pageSize: 25, offset: 0 },
		];
		for (const test of cases) {
			// RAW SQL: compare each builder filter and aggregate with its original PostgreSQL query.
			const [summary] = (await db.query(`SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE w.completed)::int AS finished, COUNT(DISTINCT w.user_id)::int AS users ${ACTIVITY_FROM} ${test.clause}`, test.params)) as Array<{ total: number; finished: number; users: number }>;
			// RAW SQL: compare the original ordered and paginated activity projection.
			const rows = (await db.query(`SELECT ${ACTIVITY_SELECT} ${ACTIVITY_FROM} ${test.clause} ORDER BY ${test.order} LIMIT $${test.params.length + 1} OFFSET $${test.params.length + 2}`, [...test.params, test.pageSize, test.offset])) as ActivityRow[];
			// RAW SQL: compare the original display-name fallback and user ordering.
			const users = await db.query("SELECT id, COALESCE(display_name, username) AS name FROM users ORDER BY name ASC");
			expect(await activity.list(test.query)).toEqual({ items: rows.map(mapActivityRow), page: test.offset / test.pageSize + 1, pageSize: test.pageSize, total: summary.total, summary: { total: summary.total, finished: summary.finished, inProgress: summary.total - summary.finished, users: summary.users }, users });
		}
	});

	it("skips locked outbox rows and claims the next available event", async () => {
		await outbox().createQueryBuilder().delete().execute();
		const [first, second] = await outbox().save([
			{ itemId: track, operation: "upsert" },
			{ itemId: track, operation: "upsert" },
		]);
		await db.transaction(async (manager) => {
			await manager.query('SELECT "event_id" FROM "media_search_outbox" WHERE "event_id" = $1 FOR UPDATE', [first.eventId]);
			const claimed = await (service as unknown as { claimEvents: () => Promise<Array<{ event_id: string }>> }).claimEvents();
			expect(claimed.map((event) => event.event_id)).toEqual([second.eventId]);
		});
		expect(await outbox().findOneByOrFail({ eventId: first.eventId })).toMatchObject({ attempts: 0, lockedUntil: null });
		expect(await outbox().findOneByOrFail({ eventId: second.eventId })).toMatchObject({ attempts: 1, lockedUntil: expect.any(Date) });
	});

	it("releases a failed outbox claim and schedules a retry", async () => {
		await outbox().createQueryBuilder().delete().execute();
		const event = await outbox().save({ itemId: track, operation: "delete" });
		const worker = service as unknown as { processOutbox: () => Promise<void>; ensureAdminSettingsLoaded: () => Promise<void>; ensureIndex: () => Promise<void>; ensureInitialIndex: () => Promise<void>; applyDocumentEvents: () => Promise<void>; warn: () => void };
		vi.spyOn(worker, "ensureAdminSettingsLoaded").mockResolvedValue();
		vi.spyOn(worker, "ensureIndex").mockResolvedValue();
		vi.spyOn(worker, "ensureInitialIndex").mockResolvedValue();
		vi.spyOn(worker, "applyDocumentEvents").mockRejectedValue(new Error("index unavailable"));
		vi.spyOn(worker, "warn").mockImplementation(() => undefined);
		await worker.processOutbox();
		const stored = await outbox().findOneByOrFail({ eventId: event.eventId });
		expect(stored).toMatchObject({ attempts: 1, lockedUntil: null, lastError: "index unavailable" });
		expect(stored.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
	});

	it("aggregates pending, failed and latest outbox errors for admin status", async () => {
		await outbox().clear();
		await outbox().save([
			{ itemId: null, operation: "upsert", lastError: null },
			{ itemId: null, operation: "delete", lastError: null },
			{ itemId: null, operation: "upsert", lastError: "index unavailable" },
		]);
		await db.getRepository(Setting).upsert({ key: MEDIA_SEARCH_ENABLED_SETTING, value: false, isPublic: false }, ["key"]);
		await expect(service.getAdminStatus()).resolves.toMatchObject({ outboxPending: 2, outboxFailed: 1, lastOutboxError: "index unavailable" });
	});
});
