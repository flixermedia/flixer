import { $log } from "@tsed/logger";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppConfig, setAppConfig } from "../../config/store/appConfig.js";
import "../../logs/loggerAppender.js";
import { loggerExporter } from "../../logs/loggerExporter.js";
import { AiAdminService } from "./aiAdminService.js";
import { AiRecommendationsService } from "./aiRecommendationsService.js";

const endpoint = process.env.LOGGER_CORRELATION_URL;
const ingest = process.env.LOGGER_CORRELATION_INGEST;
const query = process.env.LOGGER_CORRELATION_QUERY;
const aiUrl = process.env.LOGGER_CORRELATION_AI_URL;
const secret = process.env.LOGGER_CORRELATION_AI_SECRET;

describe("real AI and logger correlation", () => {
	afterEach(() => {
		$log.appenders.delete("correlation-integration");
		loggerExporter.configure();
		setAppConfig(undefined);
		vi.restoreAllMocks();
	});

	it.runIf(Boolean(endpoint && ingest && query && aiUrl && secret))("stores isolated traces from both services", async () => {
		if (!endpoint || !ingest || !query || !aiUrl || !secret) throw new Error("Missing integration settings.");
		const previousSecret = process.env.APP_SECRET;
		const previousUrl = process.env.FLIXER_AI_URL;
		process.env.APP_SECRET = secret;
		process.env.FLIXER_AI_URL = aiUrl;
		setAppConfig(new AppConfig(null));
		loggerExporter.configure({ endpoint, token: ingest, expiresAt: new Date(Date.now() + 60_000).toISOString() });
		const enqueue = vi.spyOn(loggerExporter, "enqueue");
		$log.appenders.set("correlation-integration", { type: "flixerLogger" });
		try {
			const aiAdmin = { configuration: vi.fn().mockResolvedValue({ enabled: true }) } as unknown as AiAdminService;
			const service = new AiRecommendationsService(aiAdmin);
			// A disabled AI application returns an HTTP error, but still exercises
			// the real authenticated request and middleware without loading a model.
			const results = await Promise.allSettled([
				service.recommend("private-user-one", { filters: { genres: ["private-filter-one"] } }),
				service.recommend("private-user-two", { filters: { genres: ["private-filter-two"] } }),
			]);
			expect(results.every((result) => result.status === "rejected")).toBe(true);
			const records = enqueue.mock.calls.map(([record]) => record).filter((record) => record.event === "AI_REQUEST_COMPLETED");
			expect(records).toHaveLength(2);
			const traces = records.map((record) => record.trace_id);
			expect(new Set(traces).size).toBe(2);
			for (const trace of traces) {
				expect(trace).toMatch(/^[a-f0-9]{32}$/);
				let events: { app: string; trace_id: string; message: string; duration_ms?: number }[] = [];
				for (let attempt = 0; attempt < 50; attempt++) {
					const response = await fetch(`${endpoint}/api/logs/trace/${trace}`, {
						headers: { authorization: `Bearer ${query}` },
						signal: AbortSignal.timeout(2_000),
					});
					expect(response.status).toBe(200);
					events = ((await response.json()) as { events: typeof events }).events;
					if (events.some((event) => event.app === "flixer") && events.some((event) => event.app === "flixer-ai")) break;
					await new Promise((resolve) => setTimeout(resolve, 200));
				}
				expect(events.map((event) => event.app)).toEqual(expect.arrayContaining(["flixer", "flixer-ai"]));
				expect(events.every((event) => event.trace_id === trace)).toBe(true);
				expect(events.some((event) => event.app === "flixer-ai" && event.message === "AI HTTP request completed." &&
					typeof event.duration_ms === "number")).toBe(true);
				const serialized = JSON.stringify(events);
				for (const privateValue of ["private-user-one", "private-user-two", "private-filter-one", "private-filter-two", secret]) {
					expect(serialized).not.toContain(privateValue);
				}
			}
		} finally {
			if (previousSecret === undefined) delete process.env.APP_SECRET;
			else process.env.APP_SECRET = previousSecret;
			if (previousUrl === undefined) delete process.env.FLIXER_AI_URL;
			else process.env.FLIXER_AI_URL = previousUrl;
		}
	}, 30_000);
});
