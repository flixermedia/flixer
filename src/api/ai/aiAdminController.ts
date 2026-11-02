import { Controller } from "@tsed/di";
import { BadRequest } from "@tsed/exceptions";
import { BodyParams, HeaderParams, PathParams } from "@tsed/platform-params";
import { Get, Post, Put, Security } from "@tsed/schema";
import { AuthService } from "../auth/authService.js";
import { AiRecommendationCacheService } from "./aiRecommendationCacheService.js";
import { AiAdminService } from "./aiAdminService.js";
import { UpdateAiConfigurationRequest } from "./aiAdminRequests.js";

@Controller("/admin/ai")
@Security("BearerAuth")
export class AiAdminController {
	constructor(
		private readonly authService: AuthService,
		private readonly ai: AiAdminService,
		private readonly recommendationCache: AiRecommendationCacheService,
	) {}

	@Get("/status")
	async status(@HeaderParams("authorization") authorization?: string) {
		await this.authService.requireAdmin(authorization);
		return this.ai.status();
	}

	@Put("/configuration")
	async updateConfiguration(@BodyParams() request: UpdateAiConfigurationRequest, @HeaderParams("authorization") authorization?: string) {
		await this.authService.requireAdmin(authorization);
		return this.ai.applyConfiguration(request);
	}

	@Post("/retry")
	async retry(@HeaderParams("authorization") authorization?: string) {
		await this.authService.requireAdmin(authorization);
		await this.ai.retry();
		return { accepted: true };
	}

	@Get("/recommendations")
	async recommendations(@HeaderParams("authorization") authorization?: string) {
		await this.authService.requireAdmin(authorization);
		return this.recommendationCache.listUsers();
	}

	@Post("/users/:userId/recommendations/refresh")
	async refreshUserRecommendations(@PathParams("userId") userId: string, @HeaderParams("authorization") authorization?: string) {
		await this.authService.requireAdmin(authorization);
		if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)) {
			throw new BadRequest("Invalid user ID.");
		}
		return this.ai.forceRefreshRecommendations(userId.toLowerCase());
	}
}
