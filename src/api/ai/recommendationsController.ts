import { Controller } from "@tsed/di";
import { NotFound } from "@tsed/exceptions";
import { BodyParams, HeaderParams, PathParams } from "@tsed/platform-params";
import { Get, Post, Security } from "@tsed/schema";
import { MediaAccessService, type AccessPolicy } from "../access/mediaAccessService.js";
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
		private readonly access: MediaAccessService,
	) {}

	@Get("/home")
	async homeRecommendations(@HeaderParams("authorization") authorization?: string) {
		const policy = await this.access.resolve(authorization);
		return this.homeRecommendationsFor(policy, ["movie", "series", "video"]);
	}

	@Get("/home/music")
	async musicRecommendations(@HeaderParams("authorization") authorization?: string) {
		const policy = await this.access.resolve(authorization);
		return this.homeRecommendationsFor(policy, ["album"]);
	}

	private async homeRecommendationsFor(policy: AccessPolicy, types: string[]) {
		const configuration = await this.recommendations.configuration();
		if (!configuration.enabled) {
			return { enabled: false, items: [] };
		}

		const result = await this.recommendations.recommend(policy.userId, {
			limit: 20,
			filters: { types },
		});
		const cards = await this.home.cardsByIds(result.items.map((item) => item.id), policy);
		const scores = new Map(result.items.map((item) => [item.id, item.score]));
		return {
			enabled: true,
			items: cards.map((card) => ({ ...card, score: scores.get(card.id) ?? 0 })),
		};
	}

	@Post("/")
	async recommend(@BodyParams() request: RecommendationRequest, @HeaderParams("authorization") authorization?: string) {
		const policy = await this.access.resolve(authorization);
		const result = await this.recommendations.recommend(policy.userId, request);
		return this.onlyVisible(policy, result);
	}

	@Post("/similar/:itemId")
	async similar(@PathParams("itemId") itemId: string, @BodyParams() request: RecommendationRequest, @HeaderParams("authorization") authorization?: string) {
		if (!AuthService.isUuid(itemId)) {
			throw new NotFound("Media item not found.");
		}
		const policy = await this.access.resolve(authorization);
		if (!(await this.access.isVisible(policy, itemId.toLowerCase()))) {
			throw new NotFound("Media item not found.");
		}
		return this.onlyVisible(policy, await this.recommendations.similar(policy.userId, itemId.toLowerCase(), request));
	}

	private async onlyVisible<T extends { items: Array<{ id: string }> }>(policy: AccessPolicy, result: T): Promise<T> {
		const visible = await this.access.visibleIds(policy, result.items.map((item) => item.id));
		return { ...result, items: result.items.filter((item) => visible.has(item.id)) };
	}
}
