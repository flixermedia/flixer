import { Controller } from "@tsed/di";
import { HeaderParams, QueryParams } from "@tsed/platform-params";
import { Get, Security } from "@tsed/schema";
import { AuthService } from "../auth/authService.js";
import { ActivityService } from "./activityService.js";
import { OverviewService } from "./overviewService.js";

/** Library, storage, server and activity summary for the admin dashboard overview. */
@Controller("/admin/overview")
@Security("BearerAuth")
export class OverviewController {

	constructor(
		private readonly authService: AuthService,
		private readonly overview: OverviewService,
		private readonly activity: ActivityService,
	) {}

	@Get("/")
	async get(@HeaderParams("authorization") authorization?: string) {
		await this.authService.requireAdmin(authorization);
		return this.overview.get();
	}

	/** Every watch event, filterable by text, user, kind, status and date, newest first by default. */
	@Get("/activity")
	async activityList(
		@QueryParams("search") search?: string,
		@QueryParams("user") user?: string,
		@QueryParams("type") type?: string,
		@QueryParams("status") status?: string,
		@QueryParams("from") from?: string,
		@QueryParams("to") to?: string,
		@QueryParams("sort") sort?: string,
		@QueryParams("page") page?: string,
		@QueryParams("pageSize") pageSize?: string,
		@HeaderParams("authorization") authorization?: string,
	) {
		await this.authService.requireAdmin(authorization);
		return this.activity.list({ search, user, type, status, from, to, sort, page, pageSize });
	}
}
