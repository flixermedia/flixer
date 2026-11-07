import { BadRequest, ServiceUnavailable, TooManyRequests } from "@tsed/exceptions";
import { Injectable } from "@tsed/di";
import { $log } from "@tsed/logger";
import { randomBytes, randomUUID } from "node:crypto";
import { appConfig } from "../../config/store/appConfig.js";
import type { RecommendationRequest } from "./recommendationRequests.js";
import { AiAdminService } from "./aiAdminService.js";

interface ScoredRecommendation {
	id: string;
	score: number;
	reason?: string | null;
}

interface RecommendationResponse {
	items: ScoredRecommendation[];
}

const AI_RECOMMENDATION_TIMEOUT_MS = 120_000;

function isRecommendationResponse(value: unknown): value is RecommendationResponse {
	if (typeof value !== "object" || value === null || !("items" in value) || !Array.isArray(value.items)) {
		return false;
	}
	return value.items.every((item: unknown) => {
		if (typeof item !== "object" || item === null || !("id" in item) || !("score" in item)) {
			return false;
		}
		return typeof item.id === "string" && typeof item.score === "number" && Number.isFinite(item.score) && item.score >= 0 && item.score <= 1 && (!("reason" in item) || item.reason === null || typeof item.reason === "string");
	});
}

@Injectable()
export class AiRecommendationsService {
	constructor(private readonly aiAdmin: AiAdminService) {}

	async recommend(userId: string, request: RecommendationRequest): Promise<RecommendationResponse> {
		this.validate(request);
		await this.ensureEnabled();
		return this.call("/v1/recommend", { ...request, user_id: userId });
	}

	async similar(userId: string, itemId: string, request: RecommendationRequest): Promise<RecommendationResponse> {
		this.validate(request);
		await this.ensureEnabled();
		return this.call("/v1/similar", { ...request, user_id: userId, item_id: itemId });
	}

	async configuration() {
		return this.aiAdmin.configuration();
	}

	private async ensureEnabled(): Promise<void> {
		if (!(await this.aiAdmin.configuration()).enabled) {
			throw new ServiceUnavailable("AI recommendations are disabled by the administrator.");
		}
	}

	private validate(request: RecommendationRequest): void {
		const { year_from: yearFrom, year_to: yearTo } = request.filters ?? {};
		if (yearFrom !== undefined && yearTo !== undefined && yearFrom > yearTo) {
			throw new BadRequest("year_from cannot be greater than year_to.");
		}
	}

	private async call(path: string, body: Record<string, unknown>): Promise<RecommendationResponse> {
		const baseUrl = appConfig().get("aiUrl") || "http://ai:8094";
		const token = appConfig().get("appSecret");
		if (!token || Buffer.byteLength(token) < 32) {
			throw new ServiceUnavailable("AI recommendations are not configured.");
		}

		let response: Response;
		const traceId = randomUUID().replaceAll("-", "");
		let spanId: string;
		do {
			spanId = randomBytes(8).toString("hex");
		} while (spanId === "0000000000000000");
		const started = performance.now();
		try {
			const url = new URL(path, `${baseUrl.replace(/\/+$/, "")}/`);
			if (url.protocol !== "http:" && url.protocol !== "https:") {
				throw new Error("AI recommendation URL must use HTTP or HTTPS.");
			}
			response = await fetch(url, {
				method: "POST",
				headers: {
					"content-type": "application/json",
					"x-flixer-internal-token": token,
					traceparent: `00-${traceId}-${spanId}-01`,
				},
				body: JSON.stringify(body),
				signal: AbortSignal.timeout(AI_RECOMMENDATION_TIMEOUT_MS),
			});
		} catch (error) {
			$log.warn({ event: "AI_REQUEST_FAILED", trace_id: traceId, duration_ms: performance.now() - started, message: "AI recommendation request failed." });
			if (error instanceof DOMException && error.name === "TimeoutError") {
				throw new ServiceUnavailable("The AI recommendation service timed out.");
			}
			throw new ServiceUnavailable("The AI recommendation service could not be reached.");
		}
		$log.info({ event: "AI_REQUEST_COMPLETED", trace_id: traceId, duration_ms: performance.now() - started, status_code: response.status, message: `AI recommendation request completed with HTTP ${response.status}.` });
		if (!response.ok) {
			if (response.status === 429) {
				const retryAfter = response.headers.get("retry-after");
				const error = new TooManyRequests("AI recommendations are being refreshed. Please try again shortly.");
				if (retryAfter && /^\d+$/.test(retryAfter)) {
					error.setHeader("Retry-After", retryAfter);
				}
				throw error;
			}
			throw new ServiceUnavailable(`The AI recommendation service returned HTTP ${response.status}.`);
		}

		let result: unknown;
		try {
			result = await response.json();
		} catch {
			throw new ServiceUnavailable("The AI recommendation service returned an invalid response.");
		}
		if (!isRecommendationResponse(result)) {
			throw new ServiceUnavailable("The AI recommendation service returned an invalid response.");
		}
		return result;
	}
}
