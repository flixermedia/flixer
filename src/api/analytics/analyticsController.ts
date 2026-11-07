import { Controller } from "@tsed/di";
import { BadRequest } from "@tsed/exceptions";
import { BodyParams, HeaderParams, QueryParams } from "@tsed/platform-params";
import { Get, Post, Returns, Security } from "@tsed/schema";
import { AuthService } from "../auth/authService.js";
import { AnalyticsService } from "./analyticsService.js";

@Controller("/admin/analytics")
@Security("BearerAuth")
export class AnalyticsController {
	constructor(private readonly auth: AuthService, private readonly analytics: AnalyticsService) {}

	@Get("/")
	async snapshot(@HeaderParams("authorization") authorization?: string, @QueryParams("adDays") adDays?: string) {
		await this.auth.requireAdmin(authorization);
		if (adDays !== undefined && !["7", "30", "90"].includes(adDays)) throw new BadRequest("Invalid advertising analytics range.");
		return this.analytics.snapshot(adDays === undefined ? undefined : Number(adDays));
	}

	@Get("/viewing")
	async viewing(@HeaderParams("authorization") authorization?: string, @QueryParams("days") days?: string) {
		await this.auth.requireAdmin(authorization);
		if (days !== undefined && !["7", "30", "90"].includes(days)) throw new BadRequest("Invalid viewing analytics range.");
		return this.analytics.viewing(days === undefined ? 30 : Number(days));
	}

	@Get("/music")
	async music(@HeaderParams("authorization") authorization?: string, @QueryParams("days") days?: string) {
		await this.auth.requireAdmin(authorization);
		if (days !== undefined && !["7", "30", "90"].includes(days)) throw new BadRequest("Invalid music analytics range.");
		return this.analytics.music(days === undefined ? 30 : Number(days));
	}

	@Get("/orders")
	async orders(@HeaderParams("authorization") authorization?: string, @QueryParams("days") days?: string) {
		await this.auth.requireAdmin(authorization);
		if (days !== undefined && !["7", "30", "90"].includes(days)) throw new BadRequest("Invalid order analytics range.");
		return this.analytics.orders(days === undefined ? 30 : Number(days));
	}
}

@Controller("/analytics")
@Security("BearerAuth")
export class AnalyticsReportController {
	constructor(private readonly auth: AuthService, private readonly analytics: AnalyticsService) {}

	@Post("/advertisement")
	@Returns(204)
	async advertisement(@BodyParams() body: unknown, @HeaderParams("authorization") authorization?: string) {
		const user = await this.auth.getAuthenticatedUser(authorization);
		await this.analytics.reportAdvertisement(user.id, body);
	}

	@Post("/viewing")
	@Returns(204)
	async viewing(@BodyParams() body: unknown, @HeaderParams("authorization") authorization?: string) {
		const user = await this.auth.getAuthenticatedUser(authorization);
		await this.analytics.reportViewing(user.id, body);
	}
}
