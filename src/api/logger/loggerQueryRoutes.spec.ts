import "reflect-metadata";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Configuration } from "@tsed/di";
import { Unauthorized } from "@tsed/exceptions";
import { PlatformFastify } from "@tsed/platform-fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AppConfig, setAppConfig } from "../../config/store/appConfig.js";
import { ConfigStore } from "../../config/store/configStore.js";
import { DefaultDataSource } from "../../datasources/defaultDataSource.datasource.js";
import { AuthService } from "../auth/authService.js";
import { LoggerController } from "./loggerController.js";
import { LoggerQueryProxy } from "./loggerQueryProxy.js";
import { LoggerService } from "./loggerService.js";

@Configuration({})
class TestServer {}

describe("logger query routes", () => {
	const directory = mkdtempSync(join(tmpdir(), "logger-query-routes-"));
	const store = new ConfigStore(directory);
	const requireAdmin = vi.fn(async (header?: string) => {
		if (header !== "Bearer admin") throw new Unauthorized("Admin required.");
	});
	const issueQueryToken = vi.fn(async () => ({
		endpoint: "https://logger.example", token: "query-secret", expiresAt: new Date(Date.now() + 60_000).toISOString(),
	}));
	let platform: Awaited<ReturnType<typeof PlatformFastify.bootstrap>>;

	beforeAll(async () => {
		store.setMany({ loggerUrl: "https://logger.example", loggerManageToken: "m".repeat(43) });
		setAppConfig(new AppConfig(store));
		platform = await PlatformFastify.bootstrap(TestServer, {
			httpPort: false, httpsPort: false, mount: { "/api": [LoggerController] },
			imports: [
				{ token: DefaultDataSource, use: {} },
				{ token: AuthService, use: { requireAdmin } },
				{ token: LoggerService, use: { issueQueryToken } },
				LoggerQueryProxy,
			],
		});
		await platform.listen(false);
	});

	afterAll(async () => {
		await platform?.stop();
		vi.unstubAllGlobals();
		setAppConfig(undefined);
		store.close();
		rmSync(directory, { recursive: true, force: true });
	});

	it("authorizes requests and streams search results without disclosing logger credentials", async () => {
		const fetcher = vi.fn(async (_url: string, _options: RequestInit) =>
			new Response(JSON.stringify({ events: [{ message: "route test" }] }), { headers: { "content-type": "application/json" } }));
		vi.stubGlobal("fetch", fetcher);
		const app = platform.adapter.app.getApp();
		const denied = await app.inject({ method: "GET", url: "/api/admin/logger/data/recent" });
		expect(denied.statusCode).toBe(401);
		expect(fetcher).not.toHaveBeenCalled();
		const recent = await app.inject({ method: "GET", url: "/api/admin/logger/data/recent?limit=5", headers: { authorization: "Bearer admin" } });
		expect(recent.statusCode).toBe(200);
		expect(recent.headers["cache-control"]).toBe("private, no-store");
		expect(recent.json()).toEqual({ events: [{ message: "route test" }] });
		expect(recent.body).not.toContain("query-secret");
		const search = await app.inject({
			method: "POST", url: "/api/admin/logger/data/search", headers: { authorization: "Bearer admin" },
			payload: { query: "route test", limit: 5 },
		});
		expect(search.statusCode).toBe(200);
		expect(fetcher.mock.calls[0]?.[0]).toBe("https://logger.example/api/logs?limit=5");
		expect(fetcher.mock.calls[1]?.[0]).toBe("https://logger.example/api/logs/search");
		expect(JSON.parse(String(fetcher.mock.calls[1]?.[1].body))).toEqual({ query: "route test", limit: 5 });
		expect(issueQueryToken).toHaveBeenCalledOnce();
	});

	it("forwards live stream filters and replay cursors with SSE response headers", async () => {
		const fetcher = vi.fn(async (_url: string, _options: RequestInit) =>
			new Response("id: resume-next\nevent: log\ndata: {\"message\":\"live\"}\n\n"));
		vi.stubGlobal("fetch", fetcher);
		const response = await platform.adapter.app.getApp().inject({
			method: "GET", url: "/api/admin/logger/data/stream?app=flixer",
			headers: { authorization: "Bearer admin", "last-event-id": "resume-before" },
		});
		expect(response.statusCode).toBe(200);
		expect(response.headers["content-type"]).toMatch(/^text\/event-stream/);
		expect(response.headers["x-accel-buffering"]).toBe("no");
		expect(response.body).toContain("id: resume-next");
		expect(fetcher.mock.calls[0]?.[0]).toBe("https://logger.example/api/logs/stream?app=flixer");
		expect(new Headers(fetcher.mock.calls[0]?.[1].headers).get("last-event-id")).toBe("resume-before");
	});
});
