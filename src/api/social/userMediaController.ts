import { Controller } from "@tsed/di";
import { NotFound } from "@tsed/exceptions";
import { BodyParams, HeaderParams, PathParams, QueryParams } from "@tsed/platform-params";
import { Delete, Get, Patch, Post, Put, Returns, Security } from "@tsed/schema";
import { MediaAccessService } from "../access/mediaAccessService.js";
import { AuthService } from "../auth/authService.js";
import { CreateVideoCollectionRequest, UpdateVideoCollectionRequest, UserMediaItemRequest } from "./userMediaRequests.js";
import { MAX_HISTORY_PAGE_SIZE, UserMediaService } from "./userMediaService.js";
import { PlaylistOrderRequest } from "./socialRequests.js";

function uuid(value: string, label = "Media item"): string {
	if (!AuthService.isUuid(value)) throw new NotFound(`${label} not found.`);
	return value.toLowerCase();
}

@Controller("/user-media")
@Security("BearerAuth")
export class UserMediaController {
	constructor(
		private readonly auth: AuthService,
		private readonly userMedia: UserMediaService,
		private readonly access: MediaAccessService,
	) {}

	@Get("/history")
	async history(@HeaderParams("authorization") authorization?: string, @QueryParams("offset", Number) offset?: number, @QueryParams("limit", Number) limit?: number) {
		const policy = await this.access.resolve(authorization);
		const safeOffset = Number.isSafeInteger(offset) && (offset as number) >= 0 ? offset as number : 0;
		const safeLimit = Number.isSafeInteger(limit) && (limit as number) > 0 ? Math.min(limit as number, MAX_HISTORY_PAGE_SIZE) : MAX_HISTORY_PAGE_SIZE;
		const entries = await this.userMedia.history(policy.userId, safeOffset, safeLimit + 1);
		const page = entries.slice(0, safeLimit);
		const ids = page.flatMap((entry) => entry.item ? [entry.item.id, ...entry.sourceItemIds] : []);
		const visible = await this.access.visibleIds(policy, ids);
		return {
			entries: page.filter((entry) => entry.kind === "live" || (entry.item && visible.has(entry.item.id) && entry.sourceItemIds.every((id) => visible.has(id))))
				.map(({ sourceItemIds: _sourceItemIds, ...entry }) => entry),
			hasMore: entries.length > safeLimit,
		};
	}

	@Delete("/history")
	@Returns(204)
	async clearHistory(@HeaderParams("authorization") authorization?: string) {
		const user = await this.auth.getAuthenticatedUser(authorization);
		await this.userMedia.clearHistory(user.id);
	}

	@Delete("/history/:id")
	@Returns(204)
	async removeHistory(@PathParams("id") id: string, @HeaderParams("authorization") authorization?: string) {
		const user = await this.auth.getAuthenticatedUser(authorization);
		await this.userMedia.removeHistory(user.id, uuid(id, "History entry"));
	}

	@Get("/watch-later")
	async watchLater(@HeaderParams("authorization") authorization?: string) {
		const policy = await this.access.resolve(authorization);
		const items = await this.userMedia.watchLater(policy.userId);
		const visible = await this.access.visibleIds(policy, items.map((item) => item.id));
		return { items: items.filter((item) => visible.has(item.id)) };
	}

	@Get("/watch-later/ids")
	async watchLaterIds(@HeaderParams("authorization") authorization?: string) {
		const policy = await this.access.resolve(authorization);
		const ids = await this.userMedia.watchLaterIds(policy.userId);
		const visible = await this.access.visibleIds(policy, ids);
		return { ids: ids.filter((id) => visible.has(id)) };
	}

	@Put("/watch-later/:itemId")
	@Returns(204)
	async addWatchLater(@PathParams("itemId") itemId: string, @HeaderParams("authorization") authorization?: string) {
		const policy = await this.access.resolve(authorization);
		const id = uuid(itemId);
		if (!(await this.access.isVisible(policy, id))) throw new NotFound("Media item not found.");
		await this.userMedia.addWatchLater(policy.userId, id);
	}

	@Delete("/watch-later/:itemId")
	@Returns(204)
	async removeWatchLater(@PathParams("itemId") itemId: string, @HeaderParams("authorization") authorization?: string) {
		const user = await this.auth.getAuthenticatedUser(authorization);
		await this.userMedia.removeWatchLater(user.id, uuid(itemId));
	}

	@Get("/collections")
	async collections(@HeaderParams("authorization") authorization?: string) {
		const policy = await this.access.resolve(authorization);
		return { collections: await this.userMedia.collections(policy.userId, policy) };
	}

	@Post("/collections")
	async createCollection(@BodyParams() request: CreateVideoCollectionRequest, @HeaderParams("authorization") authorization?: string) {
		const user = await this.auth.getAuthenticatedUser(authorization);
		return this.userMedia.createCollection(user.id, request);
	}

	@Get("/collections/:id")
	async collection(@PathParams("id") id: string, @HeaderParams("authorization") authorization?: string) {
		const policy = await this.access.resolve(authorization);
		const collection = await this.userMedia.collection(policy.userId, uuid(id, "Collection"));
		const visible = await this.access.visibleIds(policy, collection.items.map((item) => item.id));
		const items = collection.items.filter((item) => visible.has(item.id));
		return { ...collection, itemCount: collection.isOwner ? collection.itemCount : items.length, items };
	}

	@Patch("/collections/:id")
	async updateCollection(@PathParams("id") id: string, @BodyParams() request: UpdateVideoCollectionRequest, @HeaderParams("authorization") authorization?: string) {
		const user = await this.auth.getAuthenticatedUser(authorization);
		return this.userMedia.updateCollection(user.id, uuid(id, "Collection"), request);
	}

	@Delete("/collections/:id")
	@Returns(204)
	async deleteCollection(@PathParams("id") id: string, @HeaderParams("authorization") authorization?: string) {
		const user = await this.auth.getAuthenticatedUser(authorization);
		await this.userMedia.deleteCollection(user.id, uuid(id, "Collection"));
	}

	@Post("/collections/:id/items")
	@Returns(204)
	async addCollectionItem(@PathParams("id") id: string, @BodyParams() request: UserMediaItemRequest, @HeaderParams("authorization") authorization?: string) {
		const policy = await this.access.resolve(authorization);
		const itemId = uuid(request.itemId);
		if (!(await this.access.isVisible(policy, itemId))) throw new NotFound("Media item not found.");
		await this.userMedia.addCollectionItem(policy.userId, uuid(id, "Collection"), itemId);
	}

	@Delete("/collections/:id/items/:itemId")
	@Returns(204)
	async removeCollectionItem(@PathParams("id") id: string, @PathParams("itemId") itemId: string, @HeaderParams("authorization") authorization?: string) {
		const user = await this.auth.getAuthenticatedUser(authorization);
		await this.userMedia.removeCollectionItem(user.id, uuid(id, "Collection"), uuid(itemId));
	}

	@Put("/collections/:id/order")
	@Returns(204)
	async reorderCollection(@PathParams("id") id: string, @BodyParams() request: PlaylistOrderRequest, @HeaderParams("authorization") authorization?: string) {
		const user = await this.auth.getAuthenticatedUser(authorization);
		await this.userMedia.reorderCollection(user.id, uuid(id, "Collection"), request.itemIds.map((itemId) => uuid(itemId)));
	}

	@Get("/queue")
	async queue(@HeaderParams("authorization") authorization?: string) {
		const policy = await this.access.resolve(authorization);
		const items = await this.userMedia.queue(policy.userId);
		const visible = await this.access.visibleIds(policy, items.map((item) => item.id));
		return { items: items.filter((item) => visible.has(item.id)) };
	}

	@Post("/queue")
	@Returns(204)
	async addToQueue(@BodyParams() request: UserMediaItemRequest, @HeaderParams("authorization") authorization?: string) {
		const policy = await this.access.resolve(authorization);
		const itemId = uuid(request.itemId);
		if (!(await this.access.isVisible(policy, itemId))) throw new NotFound("Media item not found.");
		await this.userMedia.addToQueue(policy.userId, itemId);
	}

	@Put("/queue/order")
	@Returns(204)
	async reorderQueue(@BodyParams() request: PlaylistOrderRequest, @HeaderParams("authorization") authorization?: string) {
		const user = await this.auth.getAuthenticatedUser(authorization);
		await this.userMedia.reorderQueue(user.id, request.itemIds.map((itemId) => uuid(itemId)));
	}

	@Delete("/queue/:itemId")
	@Returns(204)
	async removeFromQueue(@PathParams("itemId") itemId: string, @HeaderParams("authorization") authorization?: string) {
		const user = await this.auth.getAuthenticatedUser(authorization);
		await this.userMedia.removeFromQueue(user.id, uuid(itemId));
	}

	@Delete("/queue")
	@Returns(204)
	async clearQueue(@HeaderParams("authorization") authorization?: string) {
		const user = await this.auth.getAuthenticatedUser(authorization);
		await this.userMedia.clearQueue(user.id);
	}
}