import { Controller } from "@tsed/di";
import { HeaderParams } from "@tsed/platform-params";
import { Get, Security } from "@tsed/schema";
import { AuthService } from "../auth/authService.js";
import { OverviewService } from "./overviewService.js";

/** Library, storage, server and activity summary for the admin dashboard overview. */
@Controller("/admin/overview")
@Security("BearerAuth")
export class OverviewController {

	constructor(
		private readonly authService: AuthService,
		private readonly overview: OverviewService,
	) {}

	@Get("/")
	async get(@HeaderParams("authorization") authorization?: string) {
		await this.authService.requireAdmin(authorization);
		return this.overview.get();
	}
}
