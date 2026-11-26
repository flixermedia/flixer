import { Controller } from "@tsed/di";
import { BodyParams, HeaderParams } from "@tsed/platform-params";
import { Get, Post, Security } from "@tsed/schema";
import { AuthService } from "../auth/authService.js";
import { CloudEntitlementService } from "./cloudEntitlementService.js";

/** Manages the server's link to flixer.dev Cloud and synced membership entitlements. Administrators only. */
@Controller("/admin/cloud")
@Security("BearerAuth")
export class CloudController {

	constructor(
		private readonly authService: AuthService,
		private readonly cloudEntitlements: CloudEntitlementService,
	) {}

	@Get("/")
	async status(@HeaderParams("authorization") authorization?: string) {
		await this.authService.requireAdmin(authorization);
		return this.cloudEntitlements.getStatus();
	}

	@Post("/connect/start")
	async startConnect(
		@BodyParams("redirectUri") redirectUri: string,
		@HeaderParams("authorization") authorization?: string,
	) {
		await this.authService.requireAdminSession(authorization);
		return this.cloudEntitlements.startOAuthConnect(redirectUri ?? "");
	}

	@Post("/connect/callback")
	async completeConnect(
		@BodyParams("code") code: string,
		@BodyParams("state") state: string,
		@HeaderParams("authorization") authorization?: string,
	) {
		await this.authService.requireAdminSession(authorization);
		return this.cloudEntitlements.completeOAuthCallback(code ?? "", state ?? "");
	}

	@Post("/sync")
	async sync(@HeaderParams("authorization") authorization?: string) {
		await this.authService.requireAdminSession(authorization);
		return this.cloudEntitlements.syncEntitlements();
	}

	@Post("/disconnect")
	async disconnect(@HeaderParams("authorization") authorization?: string) {
		await this.authService.requireAdminSession(authorization);
		return this.cloudEntitlements.disconnect();
	}

	@Post("/settings")
	async updateSettings(
		@BodyParams("autoSyncEnabled") autoSyncEnabled: boolean,
		@HeaderParams("authorization") authorization?: string,
	) {
		await this.authService.requireAdminSession(authorization);
		return this.cloudEntitlements.setAutoSyncEnabled(autoSyncEnabled);
	}
}
