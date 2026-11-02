import { Controller } from "@tsed/di";
import { NotFound } from "@tsed/exceptions";
import { BodyParams, HeaderParams, PathParams } from "@tsed/platform-params";
import { Get, Post, Security } from "@tsed/schema";
import { AuthService } from "../auth/authService.js";
import { MediaHomeService } from "../media/mediaHomeService.js";
import { AiRecommendationsService } from "./aiRecommendationsService.js";
import { RecommendationRequest } from "./recommendationRequests.js";

@Controller("/recommendations")
@Security("BearerAuth")
export class RecommendationsController {
	constructor(
		private readonly authService: AuthService,
		private readonly recommendations: AiRecommendationsService,
		private readonly home: MediaHomeService,
	) {}

	@Get("/home")
	async homeRecommendations(@HeaderParams("authorization") authorization?: string) {
		const user = await this.authService.getAuthenticatedUser(authorization);
		return this.homeRecommendationsFor(user.id, ["movie", "series", "video"]);
	}

	@Get("/home/music")
	async musicRecommendations(@HeaderParams("authorization") authorization?: string) {
		const user = await this.authService.getAuthenticatedUser(authorization);
		return this.homeRecommendationsFor(user.id, ["album"]);
	}

	private async homeRecommendationsFor(userId: string, types: string[]) {
		const configuration = await this.recommendations.configuration();
		if (!configuration.enabled) {
			return { enabled: false, items: [] };
		}

		const result = await this.recommendations.recommend(userId, {
			limit: 20,
			filters: { types },
		});
		const cards = await this.home.cardsByIds(result.items.map((item) => item.id));
		const scores = new Map(result.items.map((item) => [item.id, item.score]));
		return {
			enabled: true,
			items: cards.map((card) => ({ ...card, score: scores.get(card.id) ?? 0 })),
		};
	}

	@Post("/")
	async recommend(@BodyParams() request: RecommendationRequest, @HeaderParams("authorization") authorization?: string) {
		const user = await this.authService.getAuthenticatedUser(authorization);
		return this.recommendations.recommend(user.id, request);
	}

	@Post("/similar/:itemId")
	async similar(@PathParams("itemId") itemId: string, @BodyParams() request: RecommendationRequest, @HeaderParams("authorization") authorization?: string) {
		if (!AuthService.isUuid(itemId)) {
			throw new NotFound("Media item not found.");
		}
		const user = await this.authService.getAuthenticatedUser(authorization);
		return this.recommendations.similar(user.id, itemId.toLowerCase(), request);
	}
}
