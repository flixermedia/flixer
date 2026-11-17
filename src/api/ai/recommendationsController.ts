import { Controller } from "@tsed/di";
import { NotFound } from "@tsed/exceptions";
import { BodyParams, HeaderParams, PathParams } from "@tsed/platform-params";
import { Delete, Get, Post, Security } from "@tsed/schema";
import { $log } from "@tsed/logger";
import { MediaAccessService, type AccessPolicy } from "../access/mediaAccessService.js";
import { AuthService } from "../auth/authService.js";
import { MediaHomeService } from "../media/mediaHomeService.js";
import { AiRecommendationCacheService } from "./aiRecommendationCacheService.js";
import { AiRecommendationsService } from "./aiRecommendationsService.js";
import { RecommendationRequest } from "./recommendationRequests.js";
import { RecommendationFeedbackRequest } from "../social/userMediaRequests.js";
import { UserMediaService } from "../social/userMediaService.js";

@Controller("/recommendations")
@Security("BearerAuth")
export class RecommendationsController {

	constructor(
		private readonly authService: AuthService,
		private readonly recommendations: AiRecommendationsService,
		private readonly home: MediaHomeService,
		private readonly access: MediaAccessService,
		private readonly cache: AiRecommendationCacheService,
		private readonly userMedia: UserMediaService,
	) {}

	private readonly pendingHomeRefreshes = new Map<string, Promise<void>>();

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

	@Get("/feedback")
	async dismissed(@HeaderParams("authorization") authorization?: string) {
		const policy = await this.access.resolve(authorization);
		const items = await this.userMedia.dismissedRecommendationItems(policy.userId);
		const visible = await this.access.visibleIds(
			policy,
			items.map((item) => item.id),
		);
		return { items: items.filter((item) => visible.has(item.id)) };
	}

	private async homeRecommendationsFor(policy: AccessPolicy, types: string[]) {
		const configuration = await this.recommendations.configuration();
		if (!configuration.enabled) {
			return { enabled: false, items: [] };
		}

		const scope = types.includes("album") ? "music" : "movies";
		const cached = await this.cache.forHome(policy.userId, scope, types);
		const refreshKey = `${policy.userId}:${scope}`;
		if (!this.pendingHomeRefreshes.has(refreshKey)) {
			const request = {
				limit: 20,
				filters: { types },
			};
			const refresh = (cached ? this.recommendations.recommend(policy.userId, request) : this.recommendations.refresh(policy.userId, request))
				.then(
					() => undefined,
					() => {
						$log.warn({ event: "AI_HOME_REFRESH_FAILED", message: "Could not refresh home recommendations." });
					},
				)
				.finally(() => this.pendingHomeRefreshes.delete(refreshKey));
			this.pendingHomeRefreshes.set(refreshKey, refresh);
		}
		const result = cached ?? { items: [] };
		const dismissed = new Set(await this.userMedia.dismissedRecommendations(policy.userId));
		const visibleItems = result.items.filter((item) => !dismissed.has(item.id));
		const cards = await this.home.cardsByIds(
			visibleItems.map((item) => item.id),
			policy,
		);
		const scores = new Map(visibleItems.map((item) => [item.id, item.score]));
		return {
			enabled: true,
			items: cards
				.filter((card) => types.includes(card.type))
				.slice(0, 20)
				.map((card) => ({ ...card, score: scores.get(card.id) ?? 0 })),
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

	@Post("/:itemId/feedback")
	async feedback(@PathParams("itemId") itemId: string, @BodyParams() request: RecommendationFeedbackRequest, @HeaderParams("authorization") authorization?: string) {
		if (!AuthService.isUuid(itemId)) throw new NotFound("Recommendation item not found.");
		const policy = await this.access.resolve(authorization);
		const id = itemId.toLowerCase();
		if (!(await this.access.isVisible(policy, id))) throw new NotFound("Recommendation item not found.");
		await this.userMedia.setRecommendationFeedback(policy.userId, id, request.feedback);
		return { saved: true };
	}

	@Delete("/:itemId/feedback")
	async clearFeedback(@PathParams("itemId") itemId: string, @HeaderParams("authorization") authorization?: string) {
		if (!AuthService.isUuid(itemId)) throw new NotFound("Recommendation item not found.");
		const policy = await this.access.resolve(authorization);
		await this.userMedia.clearRecommendationFeedback(policy.userId, itemId.toLowerCase());
		return { cleared: true };
	}

	private async onlyVisible<T extends { items: Array<{ id: string }> }>(policy: AccessPolicy, result: T): Promise<T> {
		const visible = await this.access.visibleIds(
			policy,
			result.items.map((item) => item.id),
		);
		const dismissed = new Set(await this.userMedia.dismissedRecommendations(policy.userId));
		return { ...result, items: result.items.filter((item) => visible.has(item.id) && !dismissed.has(item.id)) };
	}
}
