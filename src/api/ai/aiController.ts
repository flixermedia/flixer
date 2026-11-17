import { Controller } from "@tsed/di";
import { NotFound } from "@tsed/exceptions";
import { BodyParams, HeaderParams, PathParams } from "@tsed/platform-params";
import { Delete, Get, Put } from "@tsed/schema";
import { AiDataService } from "./aiDataService.js";
import { AiAdminService } from "./aiAdminService.js";
import { AiRecommendationCacheService } from "./aiRecommendationCacheService.js";
import { AI_SIGNATURE_HEADER, AI_TIMESTAMP_HEADER, canonicalAiJson, verifyAiRequest } from "./aiAuth.js";

const PREFIX = "/api/internal/ai";

/** Provides minimal recommendation data to the signed flixer-ai service. */
@Controller("/internal/ai")
export class AiController {
	constructor(
		private readonly data: AiDataService,
		private readonly admin: AiAdminService,
		private readonly recommendationCache: AiRecommendationCacheService,
	) {}

	@Get("/library-context")
	async libraryContext(@HeaderParams(AI_TIMESTAMP_HEADER) timestamp?: string, @HeaderParams(AI_SIGNATURE_HEADER) signature?: string) {
		verifyAiRequest({ method: "GET", path: `${PREFIX}/library-context`, body: new Uint8Array(), timestamp, signature });
		return this.data.libraryContext();
	}

	@Get("/users/:userId/recommendation-context")
	async recommendationContext(@PathParams("userId") userId: string, @HeaderParams(AI_TIMESTAMP_HEADER) timestamp?: string, @HeaderParams(AI_SIGNATURE_HEADER) signature?: string) {
		verifyAiRequest({
			method: "GET",
			path: `${PREFIX}/users/${userId}/recommendation-context`,
			body: new Uint8Array(),
			timestamp,
			signature,
		});
		if (!AiDataService.isUserId(userId)) {
			throw new NotFound("User not found.");
		}
		return this.data.recommendationContext(userId.toLowerCase());
	}

	@Get("/runtime-configuration")
	async runtimeConfiguration(@HeaderParams(AI_TIMESTAMP_HEADER) timestamp?: string, @HeaderParams(AI_SIGNATURE_HEADER) signature?: string) {
		verifyAiRequest({ method: "GET", path: `${PREFIX}/runtime-configuration`, body: new Uint8Array(), timestamp, signature });
		return this.admin.runtimeConfiguration();
	}

	@Get("/users/:userId/recommendation-cache")
	async recommendationCacheState(@PathParams("userId") userId: string, @HeaderParams(AI_TIMESTAMP_HEADER) timestamp?: string, @HeaderParams(AI_SIGNATURE_HEADER) signature?: string) {
		const path = `${PREFIX}/users/${userId}/recommendation-cache`;
		verifyAiRequest({ method: "GET", path, body: new Uint8Array(), timestamp, signature });
		if (!AiDataService.isUserId(userId)) {
			throw new NotFound("User not found.");
		}
		return this.recommendationCache.get(userId.toLowerCase());
	}

	@Put("/users/:userId/recommendation-cache")
	async saveRecommendationCache(@PathParams("userId") userId: string, @BodyParams() request: unknown, @HeaderParams(AI_TIMESTAMP_HEADER) timestamp?: string, @HeaderParams(AI_SIGNATURE_HEADER) signature?: string) {
		const path = `${PREFIX}/users/${userId}/recommendation-cache`;
		verifyAiRequest({ method: "PUT", path, body: canonicalAiJson(request), timestamp, signature });
		if (!AiDataService.isUserId(userId)) {
			throw new NotFound("User not found.");
		}
		await this.recommendationCache.save(userId.toLowerCase(), request);
		return { saved: true };
	}

	@Delete("/recommendation-cache")
	async clearRecommendationCache(@HeaderParams(AI_TIMESTAMP_HEADER) timestamp?: string, @HeaderParams(AI_SIGNATURE_HEADER) signature?: string) {
		verifyAiRequest({ method: "DELETE", path: `${PREFIX}/recommendation-cache`, body: new Uint8Array(), timestamp, signature });
		await this.recommendationCache.clear();
		return { cleared: true };
	}
}
