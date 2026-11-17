import { describe, expect, it, vi } from "vitest";
import type { DataSource } from "typeorm";
import { RequestWebhookService, extractWebhookTargets } from "./requestWebhookService.js";

const TOKEN = "a".repeat(64);
const SERVICE_ID = "c52b71c1-b58d-4c48-bd33-e0e591c0c46d";
const LIBRARY_ID = "a9bd2c8a-7621-4804-a8b5-244ea2c8e472";

function auth(password = TOKEN) {
	return `Basic ${Buffer.from(`flixer:${password}`).toString("base64")}`;
}

function createService() {

	const service = {
		id: SERVICE_ID,
		kind: "radarr",
		enabled: true,
		libraryId: LIBRARY_ID,
		rootFolder: "/media/movies",
	};
	const setting = { key: "requests_webhook_token", value: TOKEN };
	const repository = {
		findOneBy: vi.fn(async () => setting),
		save: vi.fn(async (value) => value),
	};
	const dataSource = { getRepository: vi.fn(() => repository) };
	const services = { get: vi.fn(async () => service) };
	const libraries = {
		forIndexer: vi.fn(async () => [
			{
				id: LIBRARY_ID,
				folders: [{ absolutePath: "/media" }],
			},
		]),
	};
	const indexer = { request: vi.fn(async () => ({ queued: true, alreadyQueued: false })) };
	const webhook = new RequestWebhookService(dataSource as unknown as DataSource, services as never, libraries as never, indexer as never);
	return { webhook, indexer, service, repository, services };

}

describe("request webhook payload parsing", () => {
	it("selects only completed media paths for each Arr service", () => {
		expect(
			extractWebhookTargets("radarr", {
				eventType: "Download",
				movieFile: { path: "/media/movies/Movie/Movie.mkv" },
			}),
		).toEqual([{ path: "/media/movies/Movie/Movie.mkv", itemType: "movie" }]);
		expect(
			extractWebhookTargets("sonarr", {
				eventType: "Download",
				series: { path: "/media/tv/Show" },
				episodeFile: { relativePath: "Season 1/Episode.mkv" },
			}),
		).toEqual([{ path: "/media/tv/Show/Season 1/Episode.mkv", itemType: "episode" }]);
		expect(
			extractWebhookTargets("lidarr", {
				eventType: "Download",
				trackFiles: [{ path: "/media/music/Artist/Album/01.flac" }],
			}),
		).toEqual([{ path: "/media/music/Artist/Album/01.flac", itemType: "track" }]);
		expect(
			extractWebhookTargets("lidarr", {
				eventType: "Download",
				trackFiles: ["/media/music/Artist/Album/02.flac"],
			}),
		).toEqual([{ path: "/media/music/Artist/Album/02.flac", itemType: "track" }]);
	});

	it("ignores test and non-completion events", () => {
		expect(extractWebhookTargets("radarr", { eventType: "Test" })).toEqual([]);
		expect(extractWebhookTargets("radarr", { eventType: "Grab", movieFile: { path: "/media/movies/Movie.mkv" } })).toEqual([]);
	});
});

describe("request webhook delivery", () => {
	it("authenticates, constrains the path and queues a priority refresh", async () => {
		const { webhook, indexer } = createService();
		await expect(
			webhook.receive("radarr", SERVICE_ID, auth(), {
				eventType: "Download",
				movieFile: { path: "/media/movies/Movie/Movie.mkv" },
			}),
		).resolves.toEqual({ ok: true, ignored: false, queued: 1, alreadyQueued: 0 });
		expect(indexer.request).toHaveBeenCalledWith("POST", "/internal/refresh", {
			body: {
				libraryId: LIBRARY_ID,
				path: "/media/movies/Movie/Movie.mkv",
				itemType: "movie",
				priority: true,
			},
		});
	});

	it("rejects invalid credentials and paths outside the service root", async () => {
		const { webhook, indexer } = createService();
		await expect(
			webhook.receive("radarr", SERVICE_ID, auth("wrong"), {
				eventType: "Download",
				movieFile: { path: "/media/movies/Movie.mkv" },
			}),
		).rejects.toMatchObject({ status: 401 });
		await expect(
			webhook.receive("radarr", SERVICE_ID, auth(), {
				eventType: "Download",
				movieFile: { path: "/media/tv/Show/Episode.mkv" },
			}),
		).rejects.toThrow("outside the configured request service root folder");
		expect(indexer.request).not.toHaveBeenCalled();
	});

	it("accepts authenticated test notifications without queuing a scan", async () => {
		const { webhook, indexer, services } = createService();
		await expect(webhook.receive("radarr", SERVICE_ID, auth(), { eventType: "Test" })).resolves.toEqual({
			ok: true,
			ignored: true,
			queued: 0,
			alreadyQueued: 0,
		});
		expect(services.get).not.toHaveBeenCalled();
		expect(indexer.request).not.toHaveBeenCalled();
	});

	it("reports completed notifications that lack paths instead of silently ignoring them", async () => {
		const { webhook, indexer } = createService();
		await expect(webhook.receive("radarr", SERVICE_ID, auth(), { eventType: "Download" })).rejects.toThrow("did not include any media file paths");
		expect(indexer.request).not.toHaveBeenCalled();
	});
});
