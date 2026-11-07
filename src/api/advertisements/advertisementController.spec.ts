import "reflect-metadata";
import "@tsed/platform-multer";
import { Configuration } from "@tsed/di";
import { Unauthorized } from "@tsed/exceptions";
import { PlatformFastify } from "@tsed/platform-fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { DefaultDataSource } from "../../datasources/defaultDataSource.datasource.js";
import { AuthService } from "../auth/authService.js";
import { AdvertisementController } from "./advertisementController.js";
import { AD_CHUNK_BYTES, AdvertisementService } from "./advertisementService.js";

@Configuration({})
class TestServer {}

describe("advertisement upload endpoint", () => {
	const auth = {
		requireAdminSession: vi.fn(async (header?: string) => {
			if (header !== "Bearer admin") throw new Unauthorized("Admin required");
			return { user: { id: "admin" } };
		}),
	};
	const ads = { putChunk: vi.fn().mockResolvedValue(undefined) };
	let platform: Awaited<ReturnType<typeof PlatformFastify.bootstrap>>;

	beforeAll(async () => {
		platform = await PlatformFastify.bootstrap(TestServer, {
			httpPort: false,
			httpsPort: false,
			mount: { "/api": [AdvertisementController] },
			imports: [{ token: DefaultDataSource, use: {} }, { token: AuthService, use: auth }, { token: AdvertisementService, use: ads }],
		});
		await platform.listen(false);
	});

	afterAll(async () => {
		await platform?.stop();
	});

	it("authorizes before parsing multipart and accepts an authorized chunk", async () => {
		const app = platform.adapter.app.getApp();
		const boundary = "test-boundary";
		const body = `--${boundary}\r\nContent-Disposition: form-data; name="chunk"; filename="chunk"\r\nContent-Type: application/octet-stream\r\n\r\nabcd\r\n--${boundary}--\r\n`;
		const url = "/api/admin/advertisements/uploads/session/chunks/0";
		const headers = { "content-type": `multipart/form-data; boundary=${boundary}` };
		const denied = await app.inject({ method: "PUT", url, headers, payload: "invalid multipart" });
		expect(denied.statusCode).toBe(401);
		expect(ads.putChunk).not.toHaveBeenCalled();
		const accepted = await app.inject({ method: "PUT", url, headers: { ...headers, authorization: "Bearer admin" }, payload: body });
		expect(accepted.statusCode).toBe(200);
		expect(ads.putChunk).toHaveBeenCalledWith("session", "admin", 0, Buffer.from("abcd"));
	});

	it("rejects multipart chunks exceeding the configured limit", async () => {
		const app = platform.adapter.app.getApp();
		const payload = Buffer.concat([
			Buffer.from('--test-boundary\r\nContent-Disposition: form-data; name="chunk"; filename="chunk"\r\nContent-Type: application/octet-stream\r\n\r\n'),
			Buffer.alloc(AD_CHUNK_BYTES + 1),
			Buffer.from("\r\n--test-boundary--\r\n"),
		]);
		ads.putChunk.mockClear();
		const response = await app.inject({
			method: "PUT", url: "/api/admin/advertisements/uploads/session/chunks/0",
			headers: { "content-type": "multipart/form-data; boundary=test-boundary", authorization: "Bearer admin" }, payload,
		});
		expect(response.statusCode).toBeGreaterThanOrEqual(400);
		expect(ads.putChunk).not.toHaveBeenCalled();
	});

	it("accepts a chunk at the exact configured limit", async () => {
		const payload = Buffer.concat([
			Buffer.from('--test-boundary\r\nContent-Disposition: form-data; name="chunk"; filename="chunk"\r\nContent-Type: application/octet-stream\r\n\r\n'),
			Buffer.alloc(AD_CHUNK_BYTES),
			Buffer.from("\r\n--test-boundary--\r\n"),
		]);
		ads.putChunk.mockClear();
		const response = await platform.adapter.app.getApp().inject({
			method: "PUT", url: "/api/admin/advertisements/uploads/session/chunks/0",
			headers: { "content-type": "multipart/form-data; boundary=test-boundary", authorization: "Bearer admin" }, payload,
		});
		expect(response.statusCode).toBe(200);
		expect(ads.putChunk.mock.calls[0]?.[3].length).toBe(AD_CHUNK_BYTES);
	});
});
