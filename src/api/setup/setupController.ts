import { Controller, Inject } from "@tsed/di";
import { BodyParams, Context, HeaderParams, PathParams } from "@tsed/platform-params";
import type { PlatformContext } from "@tsed/platform-http";
import { Get, Post, Security } from "@tsed/schema";
import { DataSource } from "typeorm";
import { setupStatus } from "../../bootstrap/setupStatus.js";
import { DefaultDataSource } from "../../datasources/defaultDataSource.datasource.js";
import { User } from "../../entities/user.entity.js";
import { RECOVERY_CODE_HEADER } from "../../setup/recovery.js";
import { handleSetupRequest } from "../../setup/setupApi.js";
import { AuthService } from "../auth/authService.js";

/** Whether the installation has been set up, and the wizard's own endpoints. */
@Controller("/setup")
export class SetupController {

	constructor(
		private readonly authService: AuthService,
		@Inject(DefaultDataSource) private readonly dataSource: DataSource,
	) {}

	/** Public, and answers the same way during bootstrap and normal operation. */
	@Get("/status")
	status() {
		return setupStatus();
	}

	/** Public: writes the setup recovery key to the server log for someone locked out of the wizard. */
	@Post("/recovery/request")
	requestRecoveryKey(@Context() ctx: PlatformContext) {
		return this.run(ctx, "POST", "/recovery/request", {});
	}

	@Get("/progress")
	@Security("BearerAuth")
	progress(@Context() ctx: PlatformContext, @HeaderParams("authorization") authorization?: string) {
		return this.run(ctx, "GET", "/progress", {}, authorization);
	}

	@Post("/flow")
	@Security("BearerAuth")
	flow(@Context() ctx: PlatformContext, @BodyParams() body: unknown, @HeaderParams("authorization") authorization?: string) {
		return this.run(ctx, "POST", "/flow", body, authorization);
	}

	@Post("/steps/:step/test")
	@Security("BearerAuth")
	testStep(@Context() ctx: PlatformContext, @PathParams("step") step: string, @BodyParams() body: unknown, @HeaderParams("authorization") authorization?: string) {
		return this.run(ctx, "POST", `/steps/${step}/test`, body, authorization);
	}

	@Post("/steps/:step")
	@Security("BearerAuth")
	applyStep(@Context() ctx: PlatformContext, @PathParams("step") step: string, @BodyParams() body: unknown, @HeaderParams("authorization") authorization?: string) {
		return this.run(ctx, "POST", `/steps/${step}`, body, authorization);
	}

	@Post("/complete")
	@Security("BearerAuth")
	complete(@Context() ctx: PlatformContext, @HeaderParams("authorization") authorization?: string) {
		return this.run(ctx, "POST", "/complete", {}, authorization);
	}

	/** Reopens the wizard. Saved values stay; only a signed-in administrator session (not an API key) may do it. */
	@Post("/reset")
	@Security("BearerAuth")
	reset(@Context() ctx: PlatformContext, @BodyParams() body: unknown, @HeaderParams("authorization") authorization?: string) {
		return this.run(ctx, "POST", "/reset", body, authorization);
	}

	private async run(ctx: PlatformContext, method: string, route: string, body: unknown, authorization?: string) {
		const result = await handleSetupRequest(method, `/api/setup${route}`, body, {
			isAdmin: async () => {
				try {
					await this.authService.requireAdminSession(authorization);
					return true;
				} catch {
					return false;
				}
			},
			adminExists: async () => (await this.dataSource.getRepository(User).count({ where: { role: "admin" } })) > 0,
			recoveryCode: ctx.request.get(RECOVERY_CODE_HEADER) || undefined,
		});
		ctx.response.status(result?.status ?? 404);
		return result?.body ?? { error: "Not found." };
	}
}
