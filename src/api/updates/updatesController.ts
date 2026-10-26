import { Controller } from "@tsed/di";
import { HeaderParams, QueryParams } from "@tsed/platform-params";
import { Get, Post, Security } from "@tsed/schema";
import { AuthService } from "../auth/authService.js";
import { UpdateService } from "./updateService.js";

/** Which version of each component is running, whether newer releases exist, and applying them. Administrators only. */
@Controller("/admin/updates")
@Security("BearerAuth")
export class AdminUpdatesController {

	constructor(
		private readonly authService: AuthService,
		private readonly updates: UpdateService,
	) {}

	@Get("/")
	async status(@QueryParams("refresh", String) refresh: string | undefined, @HeaderParams("authorization") authorization?: string) {
		await this.authService.requireAdmin(authorization);
		return this.updates.status(refresh === "true");
	}

	@Post("/apply")
	async apply(@HeaderParams("authorization") authorization?: string) {
		await this.authService.requireAdminSession(authorization);
		return this.updates.apply();
	}
}
