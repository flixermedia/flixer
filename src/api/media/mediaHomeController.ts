import { Controller } from "@tsed/di";
import { NotFound } from "@tsed/exceptions";
import type { PlatformContext } from "@tsed/platform-http";
import { Context, BodyParams, HeaderParams, PathParams, QueryParams } from "@tsed/platform-params";
import { Get, Put, Returns, Security } from "@tsed/schema";
import { AuthService } from "../auth/authService.js";
import { WatchedRequest, WatchProgressRequest } from "./adminMediaRequests.js";
import { AdminMediaService } from "./adminMediaService.js";
import { MediaHomeService } from "./mediaHomeService.js";

/** What every signed-in user sees of the media library: the home page content and artwork. */
@Controller("/media")
@Security("BearerAuth")
export class MediaHomeController {
	constructor(
		private readonly authService: AuthService,
		private readonly home: MediaHomeService,
		private readonly media: AdminMediaService,
	) {}

	@Get("/home")
	async getHome(@HeaderParams("authorization") authorization?: string) {
		const user = await this.authService.getAuthenticatedUser(authorization);
		return this.home.home(user.id);
	}

	@Get("/items/:id/progress")
	async getProgress(@PathParams("id") id: string, @HeaderParams("authorization") authorization?: string) {
		const user = await this.authService.getAuthenticatedUser(authorization);
		if (!AuthService.isUuid(id)) {
			throw new NotFound("Media item not found.");
		}
		return this.home.getProgress(user.id, id.toLowerCase());
	}

	@Put("/items/:id/progress")
	@Returns(204)
	async saveProgress(
		@PathParams("id") id: string,
		@BodyParams() request: WatchProgressRequest,
		@HeaderParams("authorization") authorization?: string,
	) {
		const user = await this.authService.getAuthenticatedUser(authorization);
		if (!AuthService.isUuid(id)) {
			throw new NotFound("Media item not found.");
		}
		await this.home.saveProgress(user.id, id.toLowerCase(), request.positionSeconds, request.durationSeconds);
	}

	@Put("/items/:id/watched")
	@Returns(204)
	async setWatched(
		@PathParams("id") id: string,
		@BodyParams() request: WatchedRequest,
		@HeaderParams("authorization") authorization?: string,
	) {
		const user = await this.authService.getAuthenticatedUser(authorization);
		if (!AuthService.isUuid(id)) {
			throw new NotFound("Media item not found.");
		}
		await this.home.setWatched(user.id, id.toLowerCase(), request.watched);
	}

	@Get("/search/genres")
	async genres(@HeaderParams("authorization") authorization?: string) {
		await this.authService.getAuthenticatedUser(authorization);
		return this.home.genres();
	}

	@Get("/search")
	async search(
		@QueryParams("q", String) q: string | undefined,
		@QueryParams("type", String) type: string | undefined,
		@QueryParams("genre", String) genre: string | undefined,
		@QueryParams("yearFrom", Number) yearFrom: number | undefined,
		@QueryParams("yearTo", Number) yearTo: number | undefined,
		@QueryParams("sort", String) sort: string | undefined,
		@QueryParams("unwatched", String) unwatched: string | undefined,
		@QueryParams("includeChildren", Boolean) includeChildren: boolean | undefined,
		@Context() ctx: PlatformContext,
		@HeaderParams("authorization") authorization?: string,
	) {
		const user = await this.authService.getAuthenticatedUser(authorization);
		const result = await this.home.search(user.id, typeof q === "string" ? q : "", {
			type: typeof type === "string" ? type : undefined,
			genre: typeof genre === "string" ? genre : undefined,
			yearFrom: Number.isInteger(yearFrom) ? yearFrom : undefined,
			yearTo: Number.isInteger(yearTo) ? yearTo : undefined,
			sort: typeof sort === "string" ? sort : undefined,
			unwatched: unwatched === "true",
			includeChildren: includeChildren === true,
		});
		ctx.response.setHeader("X-Flixer-Search-Engine", result.engine);
		return result.items;
	}

	@Get("/people/:id/image")
	async personImage(
		@PathParams("id") id: string,
		@QueryParams("w", Number) width: number | undefined,
		@Context() ctx: PlatformContext,
		@HeaderParams("authorization") authorization?: string,
	) {
		await this.authService.getAuthenticatedUser(authorization);
		const { data, mime } = await this.home.personImage(id, width);
		ctx.response.setHeader("Content-Type", mime);
		ctx.response.setHeader("Cache-Control", "private, max-age=86400");
		ctx.response.setHeader("X-Content-Type-Options", "nosniff");
		ctx.response.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
		return data;
	}

	@Get("/people/:id")
	async person(@PathParams("id") id: string, @HeaderParams("authorization") authorization?: string) {
		await this.authService.getAuthenticatedUser(authorization);
		return this.home.person(id);
	}

	@Get("/browse/:kind")
	async browse(
		@PathParams("kind") kind: string,
		@QueryParams("sort", String) sort: string | undefined,
		@QueryParams("offset", Number) offset: number | undefined,
		@QueryParams("limit", Number) limit: number | undefined,
		@HeaderParams("authorization") authorization?: string,
	) {
		await this.authService.getAuthenticatedUser(authorization);
		const safeOffset = Number.isInteger(offset) && (offset as number) > 0 ? (offset as number) : 0;
		const safeLimit = Number.isInteger(limit) && (limit as number) > 0 ? Math.min(limit as number, 100) : 48;
		return this.home.browse(kind, typeof sort === "string" ? sort : "added", safeOffset, safeLimit);
	}

	@Get("/items/:id")
	async item(@PathParams("id") id: string, @HeaderParams("authorization") authorization?: string) {
		const user = await this.authService.getAuthenticatedUser(authorization);
		if (!AuthService.isUuid(id)) {
			throw new NotFound("Media item not found.");
		}
		return this.home.detail(id.toLowerCase(), user.id);
	}

	/** An image's bytes. Authenticated, so the web app fetches it with its token rather than using a plain img src. */
	@Get("/items/:id/images/:index")
	async image(
		@PathParams("id") id: string,
		@PathParams("index", Number) index: number,
		@QueryParams("w", Number) width: number | undefined,
		@Context() ctx: PlatformContext,
		@HeaderParams("authorization") authorization?: string,
	) {
		await this.authService.getAuthenticatedUser(authorization);
		if (!AuthService.isUuid(id) || !Number.isInteger(index) || index < 0) {
			throw new NotFound("Image not found.");
		}
		const { data, mime } = await this.media.image(id.toLowerCase(), index, width);
		ctx.response.setHeader("Content-Type", mime);
		ctx.response.setHeader("Cache-Control", "private, no-store");
		ctx.response.setHeader("X-Content-Type-Options", "nosniff");
		ctx.response.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
		return data;
	}
}
