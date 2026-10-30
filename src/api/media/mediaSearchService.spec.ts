import { afterEach, describe, expect, it, vi } from "vitest";
import type { DataSource } from "typeorm";
import { MediaSearchService } from "./mediaSearchService.js";

function response(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
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
			.mockResolvedValueOnce(response({}))
			.mockResolvedValueOnce(response({}))
			.mockResolvedValueOnce(response({ hits: [{ id: "item-1" }, { id: "item-2" }] }));
		vi.stubGlobal("fetch", fetch);
		const service = new MediaSearchService({} as DataSource);

		await expect(
			service.searchIds("alien", {
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
			q: "alien",
			filter: '(type = "movie" OR type = "series" OR type = "album" OR type = "video") AND genres = "Sci-Fi" AND year >= 1979 AND year <= 1986',
			sort: ["year:desc", "title:asc"],
			attributesToRetrieve: ["id"],
		});
	});

	it("sorts empty-query results by title, matching PostgreSQL's browse fallback", async () => {
		const fetch = vi
			.fn()
			.mockResolvedValueOnce(response({}))
			.mockResolvedValueOnce(response({}))
			.mockResolvedValueOnce(response({ hits: [] }));
		vi.stubGlobal("fetch", fetch);
		const service = new MediaSearchService({} as DataSource);

		await service.searchIds("");

		expect(JSON.parse(String(fetch.mock.calls[2]?.[1]?.body))).toMatchObject({
			q: "",
			sort: ["title:asc"],
		});
	});

	it("authenticates with the shared application secret by default", async () => {
		vi.stubEnv("APP_SECRET", "shared-application-secret");
		const fetch = vi
			.fn()
			.mockResolvedValueOnce(response({}))
			.mockResolvedValueOnce(response({}))
			.mockResolvedValueOnce(response({ hits: [] }));
		vi.stubGlobal("fetch", fetch);
		const service = new MediaSearchService({} as DataSource);

		await service.searchIds("alien");

		expect(new Headers(fetch.mock.calls[0]?.[1]?.headers).get("Authorization")).toBe(
			"Bearer shared-application-secret",
		);
	});

	it("returns null when Meilisearch fails so callers can use PostgreSQL", async () => {
		vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("connection refused")));
		const service = new MediaSearchService({} as DataSource);

		await expect(service.searchIds("alien")).resolves.toBeNull();
	});

	it("queues the initial index rebuild after Meilisearch becomes available", async () => {
		const query = vi.fn().mockResolvedValue([]);
		const manager = { query: vi.fn().mockResolvedValue([]) };
		const dataSource = {
			query,
			getRepository: vi.fn(() => ({ count: vi.fn().mockResolvedValue(1) })),
			transaction: vi.fn(async (callback: (manager: typeof manager) => Promise<unknown>) => callback(manager)),
		} as unknown as DataSource;
		const fetch = vi
			.fn()
			.mockRejectedValueOnce(new Error("connection refused"))
			.mockResolvedValueOnce(response({}))
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
});
