import { Controller } from "@tsed/di";
import { NotFound } from "@tsed/exceptions";
import { BodyParams, HeaderParams, PathParams, QueryParams } from "@tsed/platform-params";
import { Delete, Get, Patch, Post, Put, Returns, Security } from "@tsed/schema";
import { MediaAccessService } from "../access/mediaAccessService.js";
import { AuthService } from "../auth/authService.js";
import {
	CreateGuideSourceRequest,
	UpdateGuideChannelsRequest,
	UpdateGuideSettingsRequest,
	UpdateGuideSourceRequest,
} from "./guideRequests.js";
import { GuideService } from "./guideService.js";

@Controller("/guide")
@Security("BearerAuth")
export class GuideController {
	constructor(
		private readonly guide: GuideService,
		private readonly access: MediaAccessService,
	) {}

	@Get("/")
	async get(
		@HeaderParams("authorization") authorization?: string,
		@QueryParams("from", String) from?: string,
		@QueryParams("to", String) to?: string,
		@QueryParams("channelOffset", Number) channelOffset?: number,
		@QueryParams("channelLimit", Number) channelLimit?: number,
	) {
		// Playback of guide channels enforces the allowed-hours schedule; browsing only requires a signed-in user.
		await this.access.resolve(authorization);
		return this.guide.getGuide(from, to, channelOffset, channelLimit);
	}
}

@Controller("/admin/guide")
@Security("BearerAuth")
export class AdminGuideController {
	constructor(
		private readonly authService: AuthService,
		private readonly guide: GuideService,
	) {}

	@Get("/")
	async overview(@HeaderParams("authorization") authorization?: string) {
		await this.authService.requireAdmin(authorization);
		return this.guide.adminOverview();
	}

	@Get("/sources")
	async sources(@HeaderParams("authorization") authorization?: string) {
		await this.authService.requireAdmin(authorization);
		return this.guide.listSources();
	}

	@Post("/sources")
	async createSource(
		@BodyParams() request: CreateGuideSourceRequest,
		@HeaderParams("authorization") authorization?: string,
	) {
		await this.authService.requireAdmin(authorization);
		return this.guide.createSource(request);
	}

	@Patch("/sources/:id")
	async updateSource(
		@PathParams("id") id: string,
		@BodyParams() request: UpdateGuideSourceRequest,
		@HeaderParams("authorization") authorization?: string,
	) {
		await this.authService.requireAdmin(authorization);
		if (!AuthService.isUuid(id)) throw new NotFound("Guide source not found.");
		return this.guide.updateSource(id.toLowerCase(), request);
	}

	@Post("/sources/:id/refresh")
	async refreshSource(@PathParams("id") id: string, @HeaderParams("authorization") authorization?: string) {
		await this.authService.requireAdmin(authorization);
		if (!AuthService.isUuid(id)) throw new NotFound("Guide source not found.");
		return this.guide.refreshSourceById(id.toLowerCase());
	}

	@Delete("/sources/:id")
	@Returns(204)
	async removeSource(@PathParams("id") id: string, @HeaderParams("authorization") authorization?: string) {
		await this.authService.requireAdmin(authorization);
		if (!AuthService.isUuid(id)) throw new NotFound("Guide source not found.");
		await this.guide.removeSource(id.toLowerCase());
	}

	@Put("/channels")
	async updateChannels(
		@BodyParams() request: UpdateGuideChannelsRequest,
		@HeaderParams("authorization") authorization?: string,
	) {
		await this.authService.requireAdmin(authorization);
		await this.guide.updateChannelSettings(request.channels);
		return { updated: request.channels.length };
	}

	@Put("/settings")
	async updateSettings(
		@BodyParams() request: UpdateGuideSettingsRequest,
		@HeaderParams("authorization") authorization?: string,
	) {
		await this.authService.requireAdmin(authorization);
		return this.guide.updateRegionalThreshold(request.regionalMergeThresholdPercent);
	}
}
