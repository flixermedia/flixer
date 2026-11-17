import "reflect-metadata";
import { Configuration } from "@tsed/di";
import { Unauthorized } from "@tsed/exceptions";
import { PlatformFastify } from "@tsed/platform-fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { DefaultDataSource } from "../../datasources/defaultDataSource.datasource.js";
import { AuthService } from "../auth/authService.js";
import { LoggerService } from "./loggerService.js";
import { WebLogController, WebLogService } from "./webLogController.js";

@Configuration({})
class TestServer {}

describe("browser logging relay", () => {
	const auth = vi.fn(async (header?: string) => {
		if (header !== "Bearer test") throw new Unauthorized("Authentication required.");
		return { id: "user-1" };
	});
	const producer = vi.fn(async () => ({
		endpoint: "https://logger.example", token: "producer-secret", expiresAt: "2099-01-01T00:00:00.000Z",
	}));
	let platform: Awaited<ReturnType<typeof PlatformFastify.bootstrap>>;

	beforeAll(async () => {
		platform = await PlatformFastify.bootstrap(TestServer, {
			httpPort: false, httpsPort: false,
			mount: { "/api": [WebLogController] },
			imports: [
				{ token: DefaultDataSource, use: {} },
				{ token: AuthService, use: { getAuthenticatedUser: auth } },
				{ token: LoggerService, use: { producerIngestConfiguration: producer } },
				WebLogService,
			],
		});
		await platform.listen(false);
	});

	afterAll(async () => {
		await platform?.stop();
		vi.unstubAllGlobals();
	});

	it("authenticates, validates, and exports only the allowed error category", async () => {
		const fetcher = vi.fn(async (_url: string, options: RequestInit) =>
			new Response(JSON.stringify({ accepted: JSON.parse(String(options.body)).events.length }), { status: 200 }));
		vi.stubGlobal("fetch", fetcher);
		const app = platform.adapter.app.getApp();
		const request = { method: "POST" as const, url: "/api/logs/web", payload: { kind: "vue-error", errorType: "TypeError" } };
		expect((await app.inject(request)).statusCode).toBe(401);
		expect(producer).not.toHaveBeenCalled();
		const invalid = await app.inject({ ...request, headers: { authorization: "Bearer test" },
			payload: { ...request.payload, kind: "private token" } });
		expect(invalid.statusCode).toBe(400);
		const response = await app.inject({ ...request, headers: { authorization: "Bearer test" } });
		expect(response.statusCode).toBe(202);
		expect(response.body).not.toContain("producer-secret");
		expect(producer).toHaveBeenCalledWith("flixer-web");
		await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce(), { timeout: 3000 });
		const body = JSON.parse(String(fetcher.mock.calls[0][1].body));
		expect(body.events[0]).toMatchObject({ app: "flixer-web", source: "vue-error", message: "Browser vue-error: TypeError" });
		expect(JSON.stringify(body)).not.toContain("private token");
	});

	it("limits each authenticated user before producer enrollment", async () => {
		const app = platform.adapter.app.getApp();
		let response;
		for (let i = 0; i < 20; i++) {
			response = await app.inject({
				method: "POST", url: "/api/logs/web", headers: { authorization: "Bearer test" },
				payload: { kind: "window-error", errorType: "Error" },
			});
		}
		expect(response?.statusCode).toBe(429);
	});
});
