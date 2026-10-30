import { Controller } from "@tsed/di";
import { BodyParams, HeaderParams, PathParams } from "@tsed/platform-params";
import { Get, Post, Put, Security } from "@tsed/schema";
import { AuthService } from "../auth/authService.js";
import { MediaSearchSettingsRequest } from "./adminMediaSearchRequests.js";
import { MediaSearchService } from "./mediaSearchService.js";

/** Search-index maintenance operations for administrators. */
@Controller("/admin/search")
@Security("BearerAuth")
export class AdminMediaSearchController {

	constructor(
		private readonly authService: AuthService,
		private readonly search: MediaSearchService,
	) {}

	@Get("/status")
	async status(@HeaderParams("authorization") authorization?: string) {
		await this.authService.requireAdmin(authorization);
		return this.search.getAdminStatus();
	}

	@Get("/tasks/:uid")
	async task(@PathParams("uid", Number) uid: number, @HeaderParams("authorization") authorization?: string) {
		await this.authService.requireAdmin(authorization);
		return this.search.getAdminTask(uid);
	}

	@Put("/settings")
	async saveSettings(
		@BodyParams() request: MediaSearchSettingsRequest,
		@HeaderParams("authorization") authorization?: string,
	) {
		await this.authService.requireAdmin(authorization);
		return this.search.saveAdminSettings(request);
	}

	@Post("/rebuild")
	async rebuild(@HeaderParams("authorization") authorization?: string) {
		await this.authService.requireAdmin(authorization);
		return this.search.enqueueRebuild();
	}

	@Post("/reset")
	async reset(@HeaderParams("authorization") authorization?: string) {
		await this.authService.requireAdmin(authorization);
		return this.search.resetAndRebuild();
	}
}
