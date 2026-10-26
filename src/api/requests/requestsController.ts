import { Controller } from "@tsed/di";
import type { PlatformContext } from "@tsed/platform-http";
import { BadRequest, NotFound } from "@tsed/exceptions";
import { BodyParams, Context, HeaderParams, PathParams, QueryParams } from "@tsed/platform-params";
import { Delete, Get, Post, Put, Returns, Security } from "@tsed/schema";
import { AuthService } from "../auth/authService.js";
import { DISCOVER_SECTIONS, type DiscoverSection } from "./externalMetadata.js";
import { MediaRequestsService } from "./mediaRequestsService.js";
import {
	ApproveRequestBody,
	CreateMediaRequest,
	DeclineRequestBody,
	RequestServiceInput,
	RequestUserLimitInput,
	TestServiceInput,
} from "./requestRequests.js";
import { RequestServicesService } from "./requestServicesService.js";
import { DiscogsImageCache, TmdbImageCache } from "./tmdbImageCache.js";

function requireId(id: string): string {

	if (!AuthService.isUuid(id)) {
		throw new NotFound("Not found.");
	}
	return id.toLowerCase();

}

/** Public so cached TMDB posters can be used as <img> sources; only whitelisted TMDB image paths are ever fetched. */
@Controller("/requests/images")
export class RequestImagesController {

	constructor(
		private readonly images: TmdbImageCache,
		private readonly discogsImages: DiscogsImageCache,
	) {}

	@Get("/tmdb/:size/:file")
	async tmdb(@PathParams("size") size: string, @PathParams("file") file: string, @Context() ctx: PlatformContext) {
		const { data, mime } = await this.images.get(size, file);
		ctx.response.setHeader("Content-Type", mime);
		ctx.response.setHeader("Cache-Control", "public, max-age=2592000, immutable");
		ctx.response.setHeader("X-Content-Type-Options", "nosniff");
		ctx.response.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
		return data;
	}

	@Get("/discogs")
	async discogs(@QueryParams("u", String) source: string | undefined, @Context() ctx: PlatformContext) {
		const { data, mime } = await this.discogsImages.get(typeof source === "string" ? source : "");
		ctx.response.setHeader("Content-Type", mime);
		ctx.response.setHeader("Cache-Control", "public, max-age=2592000, immutable");
		ctx.response.setHeader("X-Content-Type-Options", "nosniff");
		ctx.response.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
		return data;
	}
}

/** Searching, discovering and requesting titles that are not in the library. */
@Controller("/requests")
@Security("BearerAuth")
export class RequestsController {

	constructor(
		private readonly authService: AuthService,
		private readonly requests: MediaRequestsService,
	) {}

	@Get("/config")
	async config(@HeaderParams("authorization") authorization?: string) {
		return this.requests.config(await this.authService.getAuthenticatedUser(authorization));
	}

	@Get("/search")
	async search(
		@QueryParams("q", String) q: string | undefined,
		@QueryParams("type", String) type: string | undefined,
		@HeaderParams("authorization") authorization?: string,
	) {
		const user = await this.authService.getAuthenticatedUser(authorization);
		return this.requests.search(user, typeof q === "string" ? q : "", typeof type === "string" ? type : undefined);
	}

	@Get("/discover")
	async discover(
		@QueryParams("section", String) section: string | undefined,
		@HeaderParams("authorization") authorization?: string,
	) {
		const user = await this.authService.getAuthenticatedUser(authorization);
		if (!DISCOVER_SECTIONS.includes(section as DiscoverSection)) {
			throw new BadRequest("Unknown discover section.");
		}
		return this.requests.discover(user, section as DiscoverSection);
	}

	@Get("/details/:type/:id")
	async details(
		@PathParams("type") type: string,
		@PathParams("id") id: string,
		@HeaderParams("authorization") authorization?: string,
	) {
		const user = await this.authService.getAuthenticatedUser(authorization);
		if (type !== "movie" && type !== "tv" && type !== "music") {
			throw new NotFound("Unknown media type.");
		}
		return this.requests.details(user, type, id);
	}

	@Get("/")
	async list(
		@QueryParams("scope", String) scope: string | undefined,
		@QueryParams("status", String) status: string | undefined,
		@QueryParams("type", String) type: string | undefined,
		@QueryParams("offset", Number) offset: number | undefined,
		@QueryParams("limit", Number) limit: number | undefined,
		@HeaderParams("authorization") authorization?: string,
	) {
		const user = await this.authService.getAuthenticatedUser(authorization);
		return this.requests.list(
			user,
			scope === "all" ? "all" : "mine",
			status,
			type,
			Number.isInteger(offset) ? (offset as number) : 0,
			Number.isInteger(limit) ? (limit as number) : 24,
		);
	}

	@Post("/")
	async create(@BodyParams() body: CreateMediaRequest, @HeaderParams("authorization") authorization?: string) {
		const user = await this.authService.getAuthenticatedUser(authorization);
		return this.requests.create(user, body);
	}

	@Post("/:id/approve")
	async approve(
		@PathParams("id") id: string,
		@BodyParams() body: ApproveRequestBody,
		@HeaderParams("authorization") authorization?: string,
	) {
		await this.authService.requireAdminSession(authorization);
		return this.requests.approve(
			await this.authService.getAuthenticatedUser(authorization),
			requireId(id),
			body ?? {},
		);
	}

	@Post("/:id/decline")
	async decline(
		@PathParams("id") id: string,
		@BodyParams() body: DeclineRequestBody,
		@HeaderParams("authorization") authorization?: string,
	) {
		await this.authService.requireAdminSession(authorization);
		return this.requests.decline(
			await this.authService.getAuthenticatedUser(authorization),
			requireId(id),
			body?.reason,
		);
	}

	@Post("/:id/retry")
	async retry(@PathParams("id") id: string, @HeaderParams("authorization") authorization?: string) {
		await this.authService.requireAdminSession(authorization);
		return this.requests.retry(await this.authService.getAuthenticatedUser(authorization), requireId(id));
	}

	@Delete("/:id")
	@Returns(204)
	async remove(@PathParams("id") id: string, @HeaderParams("authorization") authorization?: string) {
		const user = await this.authService.getAuthenticatedUser(authorization);
		await this.requests.remove(user, requireId(id));
	}
}

/** Administrators' setup of the Sonarr, Radarr and Lidarr servers and the per-user request limits. */
@Controller("/admin/requests")
@Security("BearerAuth")
export class AdminRequestsController {

	constructor(
		private readonly authService: AuthService,
		private readonly services: RequestServicesService,
		private readonly requests: MediaRequestsService,
	) {}

	@Get("/services")
	async listServices(@HeaderParams("authorization") authorization?: string) {
		await this.authService.requireAdmin(authorization);
		return this.services.list();
	}

	@Post("/services/test")
	async testService(@BodyParams() body: TestServiceInput, @HeaderParams("authorization") authorization?: string) {
		await this.authService.requireAdmin(authorization);
		return this.services.test(body);
	}

	@Post("/services")
	async createService(
		@BodyParams() body: RequestServiceInput,
		@HeaderParams("authorization") authorization?: string,
	) {
		await this.authService.requireAdmin(authorization);
		return this.services.create(body);
	}

	@Put("/services/:id")
	async updateService(
		@PathParams("id") id: string,
		@BodyParams() body: RequestServiceInput,
		@HeaderParams("authorization") authorization?: string,
	) {
		await this.authService.requireAdmin(authorization);
		return this.services.update(requireId(id), body);
	}

	@Delete("/services/:id")
	@Returns(204)
	async removeService(@PathParams("id") id: string, @HeaderParams("authorization") authorization?: string) {
		await this.authService.requireAdmin(authorization);
		await this.services.remove(requireId(id));
	}

	@Get("/users")
	async listUsers(@HeaderParams("authorization") authorization?: string) {
		await this.authService.requireAdmin(authorization);
		return this.requests.listUserLimits();
	}

	@Put("/users/:id")
	async updateUser(
		@PathParams("id") id: string,
		@BodyParams() body: RequestUserLimitInput,
		@HeaderParams("authorization") authorization?: string,
	) {
		await this.authService.requireAdmin(authorization);
		return this.requests.updateUserLimit(requireId(id), body);
	}
}
