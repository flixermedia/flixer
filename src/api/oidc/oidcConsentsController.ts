import { Controller } from "@tsed/di";
import { Context, HeaderParams, PathParams } from "@tsed/platform-params";
import type { PlatformContext } from "@tsed/platform-http";
import { Delete, Get, Returns, Security } from "@tsed/schema";
import { AuthService } from "../auth/authService.js";
import { OidcConsentService } from "./oidcConsentService.js";

/** Lists and revokes the current user's application approvals. */
@Controller("/account/oidc-apps")
@Security("BearerAuth")
export class OidcConsentsController {
	constructor(private readonly auth: AuthService, private readonly consents: OidcConsentService) {}

	@Get("/")
	async list(@HeaderParams("authorization") authorization: string | undefined, @Context() ctx: PlatformContext) {
		const { user } = await this.auth.requireAuthenticatedSession(authorization);
		ctx.response.setHeader("Cache-Control", "no-store");
		return this.consents.list(user.id);
	}

	@Delete("/:id")
	@Returns(204)
	async revoke(@PathParams("id") id: string, @HeaderParams("authorization") authorization: string | undefined) {
		const { user } = await this.auth.requireAuthenticatedSession(authorization);
		await this.consents.revoke(user.id, id);
	}
}
