import { Controller } from "@tsed/di";
import { BodyParams, HeaderParams, PathParams } from "@tsed/platform-params";
import { Delete, Get, Post, Put, Returns, Security } from "@tsed/schema";
import { AuthService } from "../auth/authService.js";
import { UserWebhookService } from "./userWebhookService.js";

/** Server policy for personal outbound webhooks. */
@Controller("/admin/user-webhooks")
@Security("BearerAuth")
export class AdminUserWebhookController {
	constructor(private readonly auth: AuthService, private readonly webhooks: UserWebhookService) {}

	@Get("/")
	async config(@HeaderParams("authorization") authorization?: string) {
		await this.auth.requireAdmin(authorization);
		return this.webhooks.config();
	}

	@Put("/")
	async update(@BodyParams() body: unknown, @HeaderParams("authorization") authorization?: string) {
		await this.auth.requireAdmin(authorization);
		return this.webhooks.updateConfig(body);
	}
}

/** Webhooks and playback reports owned by the authenticated user. */
@Controller("/user-webhooks")
@Security("BearerAuth")
export class UserWebhookController {
	constructor(private readonly auth: AuthService, private readonly webhooks: UserWebhookService) {}

	@Get("/")
	async list(@HeaderParams("authorization") authorization?: string) {
		return this.webhooks.list(await this.auth.getAuthenticatedUser(authorization));
	}

	@Post("/")
	async create(@BodyParams() body: unknown, @HeaderParams("authorization") authorization?: string) {
		return this.webhooks.save(await this.auth.getAuthenticatedUser(authorization), body);
	}

	@Put("/:id")
	async update(@PathParams("id") id: string, @BodyParams() body: unknown, @HeaderParams("authorization") authorization?: string) {
		return this.webhooks.save(await this.auth.getAuthenticatedUser(authorization), body, id);
	}

	@Delete("/:id")
	@Returns(204)
	async remove(@PathParams("id") id: string, @HeaderParams("authorization") authorization?: string) {
		await this.webhooks.remove(await this.auth.getAuthenticatedUser(authorization), id);
	}

	@Post("/playback")
	@Returns(204)
	async playback(@BodyParams() body: unknown, @HeaderParams("authorization") authorization?: string) {
		await this.webhooks.report(await this.auth.getAuthenticatedUser(authorization), body, authorization);
	}
}
