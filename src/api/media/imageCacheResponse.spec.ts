import "reflect-metadata";
import { Configuration } from "@tsed/di";
import { Unauthorized } from "@tsed/exceptions";
import { PlatformFastify } from "@tsed/platform-fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { DefaultDataSource } from "../../datasources/defaultDataSource.datasource.js";
import { MediaAccessService } from "../access/mediaAccessService.js";
import { AuthService } from "../auth/authService.js";
import { NetworkSharesService } from "../networkShares/networkSharesService.js";
import { AdminMediaService } from "./adminMediaService.js";
import { MediaHomeController } from "./mediaHomeController.js";
import { MediaHomeService } from "./mediaHomeService.js";
import { MediaTrailerService } from "./mediaTrailerService.js";

@Configuration({})
class TestServer {}

describe("native artwork revalidation", () => {
	const id = "550e8400-e29b-41d4-a716-446655440000";
	const resolve = vi.fn(async (authorization?: string) => {
		if (authorization !== "Bearer test") throw new Unauthorized("Authentication required");
		return { displayMode: "hidden" };
	});
	const blockReason = vi.fn().mockResolvedValue(null);
	const image = vi.fn().mockResolvedValue({ data: Buffer.from("image"), mime: "image/jpeg" });
	let platform: Awaited<ReturnType<typeof PlatformFastify.bootstrap>>;

	beforeAll(async () => {
		platform = await PlatformFastify.bootstrap(TestServer, {
			httpPort: false,
			httpsPort: false,
			mount: { "/api": [MediaHomeController] },
			imports: [
				{ token: AuthService, use: {} },
				{ token: MediaAccessService, use: { resolve, blockReason } },
				{ token: AdminMediaService, use: { image } },
				{ token: MediaHomeService, use: {} },
				{ token: MediaTrailerService, use: {} },
				{ token: DefaultDataSource, use: {} },
				{ token: NetworkSharesService, use: { $onInit: vi.fn(), $onDestroy: vi.fn() } },
			],
		});
		await platform.listen(false);
	});
	afterAll(async () => {
		await platform?.stop();
	});

	it("revalidates only after checking access, and returns new bytes after a change", async () => {
		const app = platform.adapter.app.getApp();
		const url = `/api/media/items/${id}/images/0`;
		const headers = { authorization: "Bearer test", "x-flixer-app-image-cache": "1" };
		const first = await app.inject({ method: "GET", url, headers });
		expect(first.statusCode).toBe(200);
		expect(first.headers.etag).toBeDefined();
		const conditional = { ...headers, "if-none-match": String(first.headers.etag) };
		const same = await app.inject({ method: "GET", url, headers: conditional });
		expect(same.statusCode).toBe(304);
		expect(same.body).toBe("");
		blockReason.mockResolvedValueOnce("library");
		expect((await app.inject({ method: "GET", url, headers: conditional })).statusCode).toBe(404);
		image.mockResolvedValueOnce({ data: Buffer.from("changed"), mime: "image/jpeg" });
		const changed = await app.inject({ method: "GET", url, headers: conditional });
		expect(changed.statusCode).toBe(200);
		expect(changed.body).toBe("changed");
		expect((await app.inject({ method: "GET", url, headers: { ...conditional, authorization: "Bearer invalid" } })).statusCode).toBe(401);
	});

	it("keeps the existing no-store policy for ordinary clients", async () => {
		const response = await platform.adapter.app.getApp().inject({
			method: "GET",
			url: `/api/media/items/${id}/images/0`,
			headers: { authorization: "Bearer test" },
		});
		expect(response.headers["cache-control"]).toBe("private, no-store");
		expect(response.headers.etag).toBeUndefined();
	});
});
