import { ServiceUnavailable, TooManyRequests } from "@tsed/exceptions";
import { $log } from "@tsed/logger";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppConfig, setAppConfig } from "../../config/store/appConfig.js";
import "../../logs/loggerAppender.js";
import { loggerExporter } from "../../logs/loggerExporter.js";
import { AiAdminService } from "./aiAdminService.js";
import { AiRecommendationsService } from "./aiRecommendationsService.js";

const originalSecret = process.env.APP_SECRET;
const originalUrl = process.env.FLIXER_AI_URL;

describe("AiRecommendationsService", () => {
	afterEach(() => {
		if (originalSecret === undefined) delete process.env.APP_SECRET;
		else process.env.APP_SECRET = originalSecret;
		if (originalUrl === undefined) delete process.env.FLIXER_AI_URL;
		else process.env.FLIXER_AI_URL = originalUrl;
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
		setAppConfig(undefined);
	});

	it("forwards the authenticated user id and recommendation filters", async () => {
		process.env.APP_SECRET = "test-shared-secret-with-at-least-32-bytes";
		process.env.FLIXER_AI_URL = "http://ai:8094";
		setAppConfig(new AppConfig(null));
		const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ items: [{ id: "media-id", score: 0.8 }] }), { status: 200 }));
		vi.stubGlobal("fetch", fetch);
		const aiAdmin = { configuration: vi.fn().mockResolvedValue({ enabled: true }) } as unknown as AiAdminService;

		const result = await new AiRecommendationsService(aiAdmin).recommend("user-id", {
			limit: 5,
			filters: { genres: ["Sci-Fi"] },
		});

		expect(result.items[0].id).toBe("media-id");
		const options = fetch.mock.calls[0][1] as RequestInit;
		const traceparent = new Headers(options.headers).get("traceparent");
		expect(traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
		expect(traceparent?.split("-")[1]).not.toBe("0".repeat(32));
		expect(traceparent?.split("-")[2]).not.toBe("0".repeat(16));
		expect(fetch).toHaveBeenCalledWith(
			new URL("/v1/recommend", "http://ai:8094/"),
			expect.objectContaining({
				method: "POST",
				headers: expect.objectContaining({ "x-flixer-internal-token": process.env.APP_SECRET }),
				body: JSON.stringify({ limit: 5, filters: { genres: ["Sci-Fi"] }, user_id: "user-id" }),
			}),
		);
	});

	it("passes the outbound trace through the real logging appender without request data", async () => {
		process.env.APP_SECRET = "test-shared-secret-with-at-least-32-bytes";
		process.env.FLIXER_AI_URL = "http://ai:8094";
		setAppConfig(new AppConfig(null));
		const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ items: [] }), { status: 200 }));
		vi.stubGlobal("fetch", fetch);
		const enqueue = vi.spyOn(loggerExporter, "enqueue").mockImplementation(() => {});
		$log.appenders.set("ai-correlation-test", { type: "flixerLogger" });
		try {
			const aiAdmin = { configuration: vi.fn().mockResolvedValue({ enabled: true }) } as unknown as AiAdminService;
			await new AiRecommendationsService(aiAdmin).recommend("private-user-id", { filters: { genres: ["private-filter"] } });
			const traceparent = new Headers((fetch.mock.calls[0][1] as RequestInit).headers).get("traceparent");
			const record = enqueue.mock.calls.map(([value]) => value).find((value) => value.event === "AI_REQUEST_COMPLETED");
			expect(record).toMatchObject({
				trace_id: traceparent?.split("-")[1],
				duration_ms: expect.any(Number),
				status_code: 200,
				message: "AI recommendation request completed with HTTP 200.",
			});
			expect(JSON.stringify(record)).not.toContain("private-user-id");
			expect(JSON.stringify(record)).not.toContain("private-filter");
			expect(JSON.stringify(record)).not.toContain(process.env.APP_SECRET);
		} finally {
			$log.appenders.delete("ai-correlation-test");
		}
	});

	it("surfaces unavailable and malformed AI responses", async () => {
		process.env.APP_SECRET = "test-shared-secret-with-at-least-32-bytes";
		setAppConfig(new AppConfig(null));
		const aiAdmin = { configuration: vi.fn().mockResolvedValue({ enabled: true }) } as unknown as AiAdminService;
		const service = new AiRecommendationsService(aiAdmin);
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("offline", { status: 503 })));
		await expect(service.recommend("user-id", {})).rejects.toThrow(ServiceUnavailable);

		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 200 })));
		await expect(service.recommend("user-id", {})).rejects.toThrow("invalid response");
	});

	it("reports recommendation timeouts explicitly", async () => {
		process.env.APP_SECRET = "test-shared-secret-with-at-least-32-bytes";
		setAppConfig(new AppConfig(null));
		const aiAdmin = { configuration: vi.fn().mockResolvedValue({ enabled: true }) } as unknown as AiAdminService;
		vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new DOMException("Timed out", "TimeoutError")));
		const service = new AiRecommendationsService(aiAdmin);

		await expect(service.recommend("user-id", {})).rejects.toThrow("AI recommendation service timed out");
	});

	it("preserves the AI service rate limit status and retry hint", async () => {
		process.env.APP_SECRET = "test-shared-secret-with-at-least-32-bytes";
		setAppConfig(new AppConfig(null));
		const aiAdmin = { configuration: vi.fn().mockResolvedValue({ enabled: true }) } as unknown as AiAdminService;
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("rate limited", { status: 429, headers: { "retry-after": "540" } })));
		const service = new AiRecommendationsService(aiAdmin);

		await expect(service.recommend("user-id", {})).rejects.toMatchObject({
			status: 429,
			headers: { "Retry-After": "540" },
		});
		await expect(service.recommend("user-id", {})).rejects.toBeInstanceOf(TooManyRequests);
	});

	it("does not call the AI service when recommendations are disabled", async () => {
		const fetch = vi.fn();
		vi.stubGlobal("fetch", fetch);
		const aiAdmin = { configuration: vi.fn().mockResolvedValue({ enabled: false }) } as unknown as AiAdminService;
		const service = new AiRecommendationsService(aiAdmin);

		await expect(service.recommend("user-id", {})).rejects.toThrow("disabled by the administrator");
		expect(fetch).not.toHaveBeenCalled();
	});
});
