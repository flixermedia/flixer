import { afterEach, describe, expect, it, vi } from "vitest";
import type { DataSource } from "typeorm";
import type { MediaItem } from "../../entities/mediaItem.entity.js";
import { MEDIA_SEARCH_ENABLED_SETTING, MEDIA_SEARCH_URL_SETTING, MediaSearchService } from "./mediaSearchService.js";

function response(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function emptySettingsDataSource(
	query = vi.fn((sql: string) => Promise.resolve(sql.startsWith('SELECT "value"') ? [{ value: 2 }] : [])),
): DataSource {
	return {
		getRepository: vi.fn(() => ({ findBy: vi.fn().mockResolvedValue([]) })),
		query,
	} as unknown as DataSource;
}

describe("MediaSearchService", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		vi.unstubAllEnvs();
	});

	it("returns matching IDs and applies index filters and sorting", async () => {
		vi.stubEnv("MEILISEARCH_URL", "http://meili.test/");
		const fetch = vi
			.fn()
			.mockResolvedValueOnce(response({ uid: "media" }))
			.mockResolvedValueOnce(response({}))
			.mockResolvedValueOnce(response({ hits: [{ id: "item-1" }, { id: "item-2" }] }));
		vi.stubGlobal("fetch", fetch);
		const service = new MediaSearchService(emptySettingsDataSource());

		await expect(
			service.searchIds("alien planet mystery", {
				type: ["movie", "series", "album", "video"],
				genre: "Sci-Fi",
				yearFrom: 1979,
				yearTo: 1986,
				sort: "year",
			}),
		).resolves.toEqual(["item-1", "item-2"]);

		const searchRequest = fetch.mock.calls[2];
		expect(searchRequest?.[0]).toBe("http://meili.test/indexes/media/search");
		expect(JSON.parse(String(searchRequest?.[1]?.body))).toMatchObject({
			q: "alien planet mystery",
			filter: '(type = "movie" OR type = "series" OR type = "album" OR type = "video") AND genres = "Sci-Fi" AND year >= 1979 AND year <= 1986',
			sort: ["year:desc", "title:asc"],
			attributesToRetrieve: ["id"],
		});
		expect(JSON.parse(String(searchRequest?.[1]?.body))).not.toHaveProperty("hybrid");
		expect(JSON.parse(String(searchRequest?.[1]?.body))).not.toHaveProperty("attributesToSearchOn");
		expect(JSON.parse(String(fetch.mock.calls[1]?.[1]?.body))).not.toHaveProperty("embedders");
	});

	it("sorts empty-query results by title, matching PostgreSQL's browse fallback", async () => {
		const fetch = vi
			.fn()
			.mockResolvedValueOnce(response({ uid: "media" }))
			.mockResolvedValueOnce(response({}))
			.mockResolvedValueOnce(response({ hits: [] }));
		vi.stubGlobal("fetch", fetch);
		const service = new MediaSearchService(emptySettingsDataSource());

		await service.searchIds("");

		expect(JSON.parse(String(fetch.mock.calls[2]?.[1]?.body))).toMatchObject({
			q: "",
			sort: ["title:asc"],
		});
		expect(JSON.parse(String(fetch.mock.calls[2]?.[1]?.body))).not.toHaveProperty("hybrid");
	});

	it.each(["scream", "breaking bad"])("searches all configured fields for short queries: %s", async (query) => {
		const fetch = vi
			.fn()
			.mockResolvedValueOnce(response({ uid: "media" }))
			.mockResolvedValueOnce(response({}))
			.mockResolvedValueOnce(response({ hits: [] }));
		vi.stubGlobal("fetch", fetch);
		const service = new MediaSearchService(emptySettingsDataSource());

		await service.searchIds(query);

		expect(JSON.parse(String(fetch.mock.calls[2]?.[1]?.body))).not.toHaveProperty("attributesToSearchOn");
		expect(JSON.parse(String(fetch.mock.calls[2]?.[1]?.body))).not.toHaveProperty("hybrid");
	});

	it("authenticates with the shared application secret by default", async () => {
		vi.stubEnv("APP_SECRET", "shared-application-secret");
		const fetch = vi
			.fn()
			.mockResolvedValueOnce(response({ uid: "media" }))
			.mockResolvedValueOnce(response({}))
			.mockResolvedValueOnce(response({ hits: [] }));
		vi.stubGlobal("fetch", fetch);
		const service = new MediaSearchService(emptySettingsDataSource());

		await service.searchIds("alien");

		expect(new Headers(fetch.mock.calls[0]?.[1]?.headers).get("Authorization")).toBe(
			"Bearer shared-application-secret",
		);
	});

	it("reuses an existing media index instead of trying to create it again", async () => {
		const fetch = vi
			.fn()
			.mockResolvedValueOnce(response({ uid: "media" }))
			.mockResolvedValueOnce(response({}))
			.mockResolvedValueOnce(response({ hits: [] }));
		vi.stubGlobal("fetch", fetch);
		const service = new MediaSearchService(emptySettingsDataSource());

		await expect(service.searchIds("alien")).resolves.toEqual([]);

		expect(fetch.mock.calls[0]?.[0]).toBe("http://localhost:7700/indexes/media");
		expect(fetch.mock.calls[1]?.[0]).toBe("http://localhost:7700/indexes/media/settings");
		expect(fetch.mock.calls.some(([url]) => url === "http://localhost:7700/indexes")).toBe(false);
	});

	it("configures the existing index for keyword search", async () => {
		const fetch = vi
			.fn()
			.mockResolvedValueOnce(response({ uid: "media" }))
			.mockResolvedValueOnce(response({ taskUid: 2 }))
			.mockResolvedValueOnce(response({ status: "succeeded" }))
			.mockResolvedValueOnce(response({ hits: [] }));
		vi.stubGlobal("fetch", fetch);
		const service = new MediaSearchService(emptySettingsDataSource());

		await expect(service.searchIds("alien")).resolves.toEqual([]);

		expect(fetch.mock.calls[1]?.[0]).toBe("http://localhost:7700/indexes/media/settings");
		expect(JSON.parse(String(fetch.mock.calls[1]?.[1]?.body))).not.toHaveProperty("embedders");
	});

	it("recreates the derived index and falls back to PostgreSQL while rebuilding", async () => {
		const fetch = vi
			.fn()
			.mockResolvedValueOnce(response({ uid: "media" }))
			.mockResolvedValueOnce(response({ taskUid: 1 }))
			.mockResolvedValueOnce(response({ status: "succeeded" }))
			.mockResolvedValueOnce(response({ taskUid: 2 }))
			.mockResolvedValueOnce(response({ status: "succeeded" }))
			.mockResolvedValueOnce(response({ taskUid: 3 }))
			.mockResolvedValueOnce(response({ status: "succeeded" }));
		vi.stubGlobal("fetch", fetch);
		const query = vi.fn().mockResolvedValue([]);
		const service = new MediaSearchService(emptySettingsDataSource(query));

		await expect(service.searchIds("alien")).resolves.toBeNull();

		expect(fetch.mock.calls[1]?.[0]).toBe("http://localhost:7700/indexes/media");
		expect(fetch.mock.calls[1]?.[1]?.method).toBe("DELETE");
		expect(fetch.mock.calls[3]?.[0]).toBe("http://localhost:7700/indexes");
		expect(JSON.parse(String(fetch.mock.calls[5]?.[1]?.body))).not.toHaveProperty("embedders");
		expect(fetch.mock.calls.some(([url]) => String(url).includes("/settings/embedders"))).toBe(false);
		expect(fetch.mock.calls.some(([url]) => String(url).endsWith("/search"))).toBe(false);
		expect(query.mock.calls.some(([sql]) => String(sql).includes("VALUES ('rebuild')"))).toBe(true);
		expect(query.mock.calls.some(([sql]) => String(sql).includes('DELETE FROM "settings"'))).toBe(true);
		expect(
			query.mock.calls.some(
				([, parameters]) => Array.isArray(parameters) && parameters.includes("media_search_document_version"),
			),
		).toBe(true);
	});

	it("records the search document version after a completed rebuild", async () => {
		const builder = {
			select: vi.fn().mockReturnThis(),
			where: vi.fn().mockReturnThis(),
			orderBy: vi.fn().mockReturnThis(),
			take: vi.fn().mockReturnThis(),
			getMany: vi.fn().mockResolvedValue([]),
		};
		const query = vi.fn().mockResolvedValue([]);
		vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(response({})));
		const service = new MediaSearchService({
			getRepository: vi.fn(() => ({ createQueryBuilder: vi.fn(() => builder) })),
			query,
		} as unknown as DataSource);
		const worker = service as unknown as { rebuildIndex: () => Promise<void> };

		await worker.rebuildIndex();

		expect(query.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO "settings"'))?.[1]).toEqual([
			"media_search_document_version",
			"2",
		]);
	});

	it("builds separate search fields for shows, episodes, albums, and tracks", async () => {
		const items = [
			{
				id: "series",
				type: "series",
				title: "Show",
				parentId: null,
				year: 2020,
				metadata: { cast: [{ name: "Actor" }], studios: ["Studio"] },
				isPlaceholder: false,
			},
			{
				id: "season",
				type: "season",
				title: "Season 1",
				parentId: "series",
				year: null,
				metadata: {},
				isPlaceholder: false,
			},
			{
				id: "episode",
				type: "episode",
				title: "Pilot",
				parentId: "season",
				year: null,
				metadata: { overview: "Episode description" },
				isPlaceholder: false,
			},
			{
				id: "album",
				type: "album",
				title: "Record",
				parentId: null,
				year: 2021,
				metadata: { artist: "Singer", overview: "Album description" },
				isPlaceholder: false,
			},
			{
				id: "track",
				type: "track",
				title: "Song",
				parentId: "album",
				year: null,
				metadata: { description: "Track description", artist: "Singer" },
				isPlaceholder: false,
			},
		].map(
			(item) => ({ ...item, sortTitle: item.title, genres: [], createdAt: new Date() }) as unknown as MediaItem,
		);
		const query = vi.fn((sql: string) =>
			Promise.resolve(
				sql.includes("WITH RECURSIVE")
					? items.map(({ id }) => ({ id }))
					: sql.includes("media_search_lyrics")
						? [{ item_id: "track", lyrics: "song lyric words" }]
						: [],
			),
		);
		const service = new MediaSearchService({
			query,
			getRepository: vi.fn(() => ({ find: vi.fn().mockResolvedValue(items) })),
		} as unknown as DataSource);
		const worker = service as unknown as {
			searchDocumentsFor: (ids: string[]) => Promise<Array<Record<string, unknown>>>;
		};

		const documents = await worker.searchDocumentsFor(["series", "episode", "album", "track"]);
		const byId = new Map(documents.map((document) => [document.id, document]));

		expect(byId.get("series")).toMatchObject({
			title: "Show",
			childTitles: ["Pilot"],
			credits: ["Actor"],
			studios: ["Studio"],
		});
		expect(byId.get("episode")).toMatchObject({
			title: "Pilot",
			parentTitle: "Show",
			credits: [],
			studios: [],
			description: "Episode description",
		});
		expect(byId.get("album")).toMatchObject({
			title: "Record",
			childTitles: ["Song"],
			artist: ["Singer"],
			description: "Album description",
		});
		expect(byId.get("track")).toMatchObject({
			title: "Song",
			parentTitle: "Record",
			artist: ["Singer"],
			lyrics: "song lyric words",
		});
		expect(byId.has("season")).toBe(false);
	});

	it("persists lyrics separately and queues the track for reindexing", async () => {
		const managerQuery = vi.fn().mockResolvedValue([]);
		const manager = { query: managerQuery };
		const dataSource = {
			getRepository: vi.fn(() => ({
				findOne: vi.fn().mockResolvedValue({ id: "track-1" }),
			})),
			transaction: vi.fn(async (callback: (manager: typeof manager) => Promise<void>) => callback(manager)),
		} as unknown as DataSource;
		const service = new MediaSearchService(dataSource);

		await service.storeTrackLyrics("track-1", "[00:01.00]lyrics");

		expect(managerQuery.mock.calls[0]?.[0]).toContain('INSERT INTO "media_search_lyrics"');
		expect(managerQuery.mock.calls[0]?.[1]).toEqual(["track-1", "[00:01.00]lyrics"]);
		expect(managerQuery.mock.calls[1]?.[0]).toContain(`VALUES ($1, 'upsert')`);
		expect(managerQuery.mock.calls[1]?.[1]).toEqual(["track-1"]);
	});

	it("creates the media index when it does not exist", async () => {
		const fetch = vi
			.fn()
			.mockResolvedValueOnce(response({ code: "index_not_found" }, 404))
			.mockResolvedValueOnce(response({ taskUid: 1 }))
			.mockResolvedValueOnce(response({ status: "succeeded" }))
			.mockResolvedValueOnce(response({}))
			.mockResolvedValueOnce(response({ hits: [] }));
		vi.stubGlobal("fetch", fetch);
		const service = new MediaSearchService(emptySettingsDataSource());

		await expect(service.searchIds("alien")).resolves.toEqual([]);

		expect(fetch.mock.calls[1]?.[0]).toBe("http://localhost:7700/indexes");
		expect(JSON.parse(String(fetch.mock.calls[1]?.[1]?.body))).toEqual({ uid: "media", primaryKey: "id" });
	});

	it("returns null when Meilisearch fails so callers can use PostgreSQL", async () => {
		vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("connection refused")));
		const service = new MediaSearchService(emptySettingsDataSource());

		await expect(service.searchIds("alien")).resolves.toBeNull();
	});

	it("queues the initial index rebuild after Meilisearch becomes available", async () => {
		const query = vi.fn((sql: string) => Promise.resolve(sql.startsWith('SELECT "value"') ? [{ value: 2 }] : []));
		const manager = { query: vi.fn().mockResolvedValue([]) };
		const dataSource = {
			query,
			getRepository: vi.fn(() => ({
				count: vi.fn().mockResolvedValue(1),
				findBy: vi.fn().mockResolvedValue([]),
			})),
			transaction: vi.fn(async (callback: (manager: typeof manager) => Promise<unknown>) => callback(manager)),
		} as unknown as DataSource;
		const fetch = vi
			.fn()
			.mockRejectedValueOnce(new Error("connection refused"))
			.mockResolvedValueOnce(response({ uid: "media" }))
			.mockResolvedValueOnce(response({}))
			.mockResolvedValueOnce(response({ numberOfDocuments: 0 }));
		vi.stubGlobal("fetch", fetch);
		const service = new MediaSearchService(dataSource);
		const worker = service as unknown as { processOutbox: () => Promise<void> };

		await worker.processOutbox();
		await worker.processOutbox();

		expect(query).toHaveBeenCalledWith(expect.stringContaining("VALUES ('rebuild')"));
	});

	it("reports whether a rebuild request was newly queued", async () => {
		const query = vi
			.fn()
			.mockResolvedValueOnce([{ event_id: "1" }])
			.mockResolvedValueOnce([]);
		const service = new MediaSearchService({ query } as unknown as DataSource);

		await expect(service.enqueueRebuild()).resolves.toEqual({ queued: true });
		await expect(service.enqueueRebuild()).resolves.toEqual({ queued: false });
		expect(query).toHaveBeenCalledTimes(2);
	});

	it("queues a durable reset operation for the media index", async () => {
		const query = vi.fn().mockResolvedValue([{ event_id: "1" }]);
		const service = new MediaSearchService(emptySettingsDataSource(query));

		await expect(service.resetAndRebuild()).resolves.toEqual({ queued: true });

		expect(query.mock.calls[0]?.[0]).toContain("VALUES ('reset')");
		expect(query.mock.calls[0]?.[0]).toContain(`WHERE "operation" = 'reset'`);
	});

	it("does not reset Meilisearch while it is disabled", async () => {
		const query = vi.fn();
		const service = new MediaSearchService({
			getRepository: vi.fn(() => ({
				findBy: vi.fn().mockResolvedValue([{ key: MEDIA_SEARCH_ENABLED_SETTING, value: false }]),
			})),
			query,
		} as unknown as DataSource);

		await expect(service.resetAndRebuild()).rejects.toThrow("Enable Meilisearch");
		expect(query).not.toHaveBeenCalled();
	});

	it("recreates the media index with defaults before rebuilding its documents", async () => {
		const builder = {
			select: vi.fn().mockReturnThis(),
			where: vi.fn().mockReturnThis(),
			orderBy: vi.fn().mockReturnThis(),
			take: vi.fn().mockReturnThis(),
			getMany: vi.fn().mockResolvedValue([]),
		};
		const fetch = vi
			.fn()
			.mockResolvedValueOnce(response({ taskUid: 1 }))
			.mockResolvedValueOnce(response({ status: "succeeded" }))
			.mockResolvedValueOnce(response({ taskUid: 2 }))
			.mockResolvedValueOnce(response({ status: "succeeded" }))
			.mockResolvedValueOnce(response({ taskUid: 3 }))
			.mockResolvedValueOnce(response({ status: "succeeded" }))
			.mockResolvedValueOnce(response({ taskUid: 4 }))
			.mockResolvedValueOnce(response({ status: "succeeded" }));
		vi.stubGlobal("fetch", fetch);
		const query = vi.fn().mockResolvedValue([]);
		const service = new MediaSearchService({
			getRepository: vi.fn(() => ({ createQueryBuilder: vi.fn(() => builder) })),
			query,
		} as unknown as DataSource);
		const worker = service as unknown as { resetIndex: () => Promise<void> };

		await worker.resetIndex();

		expect(fetch.mock.calls.map(([url, init]) => [url, init?.method])).toEqual([
			["http://localhost:7700/indexes/media", "DELETE"],
			["http://localhost:7700/tasks/1", undefined],
			["http://localhost:7700/indexes", "POST"],
			["http://localhost:7700/tasks/2", undefined],
			["http://localhost:7700/indexes/media/settings", "PATCH"],
			["http://localhost:7700/tasks/3", undefined],
			["http://localhost:7700/indexes/media/documents", "DELETE"],
			["http://localhost:7700/tasks/4", undefined],
		]);
		expect(JSON.parse(String(fetch.mock.calls[4]?.[1]?.body))).toEqual({
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
		});
		expect(query.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO "settings"'))?.[1]).toEqual([
			"media_search_document_version",
			"2",
		]);
	});

	it("reports saved settings and outbox status without contacting Meilisearch when disabled", async () => {
		const findBy = vi.fn().mockResolvedValue([
			{ key: MEDIA_SEARCH_ENABLED_SETTING, value: false },
			{ key: MEDIA_SEARCH_URL_SETTING, value: "http://meili.test" },
		]);
		const query = vi.fn().mockResolvedValue([{ pending: 2, failed: 1, last_error: "index unavailable" }]);
		const fetch = vi.fn();
		vi.stubGlobal("fetch", fetch);
		const service = new MediaSearchService({
			getRepository: vi.fn(() => ({ findBy })),
			query,
		} as unknown as DataSource);

		await expect(service.getAdminStatus()).resolves.toMatchObject({
			enabled: false,
			url: "http://meili.test",
			customUrl: "http://meili.test",
			urlSource: "database",
			connected: null,
			indexExists: null,
			outboxPending: 2,
			outboxFailed: 1,
			lastOutboxError: "index unavailable",
		});
		expect(fetch).not.toHaveBeenCalled();
	});

	it("reports recent Meilisearch tasks for the media index", async () => {
		const task = {
			uid: 3549,
			indexUid: "media",
			status: "processing",
			type: "documentAdditionOrUpdate",
			enqueuedAt: "2026-10-30T17:20:00.000Z",
			startedAt: "2026-10-30T17:20:01.000Z",
			finishedAt: null,
			duration: null,
			error: null,
		};
		const fetch = vi
			.fn()
			.mockResolvedValueOnce(response({ status: "available" }))
			.mockResolvedValueOnce(response({ numberOfDocuments: 12 }))
			.mockResolvedValueOnce(response({ results: [task] }));
		vi.stubGlobal("fetch", fetch);
		const service = new MediaSearchService({
			getRepository: vi.fn(() => ({ findBy: vi.fn().mockResolvedValue([]) })),
			query: vi.fn().mockResolvedValue([{ pending: 0, failed: 0, last_error: null }]),
		} as unknown as DataSource);

		await expect(service.getAdminStatus()).resolves.toMatchObject({
			connected: true,
			tasks: [task],
			tasksError: null,
		});
		expect(fetch.mock.calls[2]?.[0]).toBe("http://localhost:7700/tasks?indexUids=media&limit=10");
	});

	it("returns the full details for a media-index task", async () => {
		const task = {
			uid: 3546,
			indexUid: "media",
			status: "processing",
			type: "settingsUpdate",
			enqueuedAt: "2026-10-30T17:27:25.000Z",
			startedAt: "2026-10-30T17:27:25.000Z",
			finishedAt: null,
			duration: null,
			details: { searchableAttributes: ["title", "searchText"] },
			error: null,
		};
		const fetch = vi.fn().mockResolvedValueOnce(response(task));
		vi.stubGlobal("fetch", fetch);
		const service = new MediaSearchService(emptySettingsDataSource());

		await expect(service.getAdminTask(3546)).resolves.toEqual(task);
		expect(fetch.mock.calls[0]?.[0]).toBe("http://localhost:7700/tasks/3546");
	});

	it("rejects Meilisearch task details for another index", async () => {
		const fetch = vi.fn().mockResolvedValueOnce(response({ uid: 3546, indexUid: "users" }));
		vi.stubGlobal("fetch", fetch);
		const service = new MediaSearchService(emptySettingsDataSource());

		await expect(service.getAdminTask(3546)).rejects.toThrow("Meilisearch task not found");
	});

	it("persists an override and queues a rebuild when the effective URL changes", async () => {
		const settings = new Map<string, { key: string; value: unknown; isPublic: false }>();
		const repository = {
			findBy: vi.fn(async () => [...settings.values()]),
			findOneBy: vi.fn(async ({ key }: { key: string }) => settings.get(key)),
			save: vi.fn(async (setting: { key: string; value: unknown; isPublic?: false }) => {
				const saved = { ...setting, isPublic: false as const };
				settings.set(saved.key, saved);
				return saved;
			}),
		};
		const query = vi
			.fn()
			.mockResolvedValueOnce([{ event_id: "1" }])
			.mockResolvedValueOnce([{ pending: 1, failed: 0, last_error: null }]);
		const fetch = vi
			.fn()
			.mockResolvedValueOnce(response({ status: "available" }))
			.mockResolvedValueOnce(response({ numberOfDocuments: 12 }))
			.mockResolvedValueOnce(response({ results: [] }));
		vi.stubGlobal("fetch", fetch);
		const service = new MediaSearchService({
			getRepository: vi.fn(() => repository),
			query,
		} as unknown as DataSource);

		await expect(
			service.saveAdminSettings({
				enabled: true,
				url: "http://meili.test/",
			}),
		).resolves.toMatchObject({
			enabled: true,
			url: "http://meili.test",
			customUrl: "http://meili.test",
			urlSource: "database",
			connected: true,
			indexExists: true,
			documentCount: 12,
		});
		expect(settings.get(MEDIA_SEARCH_ENABLED_SETTING)?.value).toBe(true);
		expect(settings.get(MEDIA_SEARCH_URL_SETTING)?.value).toBe("http://meili.test");
		expect(query).toHaveBeenCalledWith(expect.stringContaining("VALUES ('rebuild')"));
	});

	it("allows an empty URL to clear the Meilisearch override", async () => {
		const settings = new Map<string, { key: string; value: unknown; isPublic: false }>();
		const repository = {
			findBy: vi.fn(async () => [...settings.values()]),
			findOneBy: vi.fn(async ({ key }: { key: string }) => settings.get(key)),
			save: vi.fn(async (setting: { key: string; value: unknown; isPublic?: false }) => {
				const saved = { ...setting, isPublic: false as const };
				settings.set(saved.key, saved);
				return saved;
			}),
		};
		const query = vi.fn().mockResolvedValue([{ pending: 0, failed: 0, last_error: null }]);
		const fetch = vi
			.fn()
			.mockResolvedValueOnce(response({ status: "available" }))
			.mockResolvedValueOnce(response({ numberOfDocuments: 12 }))
			.mockResolvedValueOnce(response({ results: [] }));
		vi.stubEnv("MEILISEARCH_URL", "http://meili.test");
		vi.stubGlobal("fetch", fetch);
		const service = new MediaSearchService({
			getRepository: vi.fn(() => repository),
			query,
		} as unknown as DataSource);

		await expect(service.saveAdminSettings({ enabled: true, url: "" })).resolves.toMatchObject({
			customUrl: "",
			url: "http://meili.test",
			urlSource: "environment",
		});
		expect(settings.get(MEDIA_SEARCH_URL_SETTING)?.value).toBe("");
	});

	it("rejects Meilisearch URLs containing credentials or non-HTTP protocols", async () => {
		const findOneBy = vi.fn();
		const service = new MediaSearchService({
			getRepository: vi.fn(() => ({ findOneBy })),
		} as unknown as DataSource);

		await expect(service.saveAdminSettings({ enabled: true, url: "https://user:pass@meili.test" })).rejects.toThrow(
			"without credentials",
		);
		await expect(service.saveAdminSettings({ enabled: true, url: "ftp://meili.test" })).rejects.toThrow(
			"without credentials",
		);
		await expect(service.saveAdminSettings({ enabled: true, url: "x".repeat(2049) })).rejects.toThrow(
			"settings are invalid",
		);
		expect(findOneBy).not.toHaveBeenCalled();
	});
});
