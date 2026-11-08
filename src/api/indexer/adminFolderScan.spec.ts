import "reflect-metadata";
import { Configuration } from "@tsed/di";
import { BadRequest, Unauthorized } from "@tsed/exceptions";
import { PlatformFastify } from "@tsed/platform-fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { LiveService } from "../../live/liveService.js";
import { AuthService } from "../auth/authService.js";
import { MediaLibrariesService } from "../mediaLibraries/mediaLibrariesService.js";
import { AdminIndexerController } from "./adminIndexerController.js";
import { AdminIndexerService } from "./adminIndexerService.js";
import { IndexerClient } from "./indexerClient.js";
import { DefaultDataSource } from "../../datasources/defaultDataSource.datasource.js";
import { NetworkSharesService } from "../networkShares/networkSharesService.js";

@Configuration({})
class TestServer {}

describe("folder scan endpoint", () => {
	const id = "550e8400-e29b-41d4-a716-446655440000";
	const auth = { requireAdmin: vi.fn(async (header?: string) => {
		if (header !== "Bearer test") throw new Unauthorized("Admin required");
	}) };
	const libraries = { scanPaths: vi.fn().mockResolvedValue(["/media/Movies/Selected"]) };
	const indexer = { request: vi.fn().mockResolvedValue({ queued: true, alreadyQueued: false }) };
	const live = { invalidate: vi.fn(), $onReady: vi.fn(), $onDestroy: vi.fn() };
	let platform: Awaited<ReturnType<typeof PlatformFastify.bootstrap>>;

	beforeAll(async () => {
		platform = await PlatformFastify.bootstrap(TestServer, {
			httpPort: false, httpsPort: false, mount: { "/api": [AdminIndexerController] },
			imports: [
				{ token: AuthService, use: auth }, { token: MediaLibrariesService, use: libraries },
				{ token: IndexerClient, use: indexer }, { token: LiveService, use: live },
				{ token: AdminIndexerService, use: {} },
				{ token: DefaultDataSource, use: {} },
				{ token: NetworkSharesService, use: { $onInit: vi.fn(), $onDestroy: vi.fn() } },
			],
		});
		await platform.listen(false);
	});

	afterAll(async () => { await platform?.stop(); });

	it("requires an admin and forwards validated folder paths to the indexer", async () => {
		const app = platform.adapter.app.getApp();
		const url = `/api/admin/indexer/libraries/${id}/scan`;
		const payload = { folders: [{ rootId: "root", path: "Movies/Selected" }] };
		const denied = await app.inject({ method: "POST", url, payload });
		expect(denied.statusCode).toBe(401);
		expect(indexer.request).not.toHaveBeenCalled();
		const accepted = await app.inject({ method: "POST", url, headers: { authorization: "Bearer test" }, payload });
		expect(accepted.statusCode).toBe(200);
		expect(libraries.scanPaths).toHaveBeenCalledWith(id, payload.folders);
		expect(indexer.request).toHaveBeenCalledWith("POST", "/internal/scan", { body: {
			libraryId: id, force: false, trickplayOnly: false, jobs: [], paths: ["/media/Movies/Selected"],
		} });
	});

	it("does not queue invalid folders or combine them with trickplay", async () => {
		const app = platform.adapter.app.getApp();
		const url = `/api/admin/indexer/libraries/${id}/scan`;
		const headers = { authorization: "Bearer test" };
		indexer.request.mockClear();
		libraries.scanPaths.mockRejectedValueOnce(new BadRequest("Folder is not part of this library."));
		const invalid = await app.inject({ method: "POST", url, headers, payload: { folders: [{ rootId: "root", path: "Outside" }] } });
		expect(invalid.statusCode).toBe(400);
		const incompatible = await app.inject({ method: "POST", url, headers, payload: { trickplayOnly: true, folders: [{ rootId: "root", path: "Movies" }] } });
		expect(incompatible.statusCode).toBe(400);
		expect(indexer.request).not.toHaveBeenCalled();
	});

	it("retains full-library scan behavior when no folders are supplied", async () => {
		const response = await platform.adapter.app.getApp().inject({
			method: "POST", url: `/api/admin/indexer/libraries/${id}/scan`,
			headers: { authorization: "Bearer test" }, payload: { force: true },
		});
		expect(response.statusCode).toBe(200);
		expect(indexer.request).toHaveBeenLastCalledWith("POST", "/internal/scan", { body: {
			libraryId: id, force: true, trickplayOnly: false, jobs: [],
		} });
	});
});
