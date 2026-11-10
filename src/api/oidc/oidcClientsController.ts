import { Controller } from "@tsed/di";
import type { PlatformContext } from "@tsed/platform-http";
import { BodyParams, Context, HeaderParams, PathParams } from "@tsed/platform-params";
import { Delete, Get, Post, Put, Returns, Security } from "@tsed/schema";
import { AuthService } from "../auth/authService.js";
import { CreateOidcClientRequest, UpdateOidcConfigurationRequest } from "./oidcClientRequests.js";
import { OidcClientService } from "./oidcClientService.js";
import { OidcProviderService } from "./oidcProviderService.js";

/** Administrator-managed OAuth client registrations. */
@Controller("/admin/oidc/clients")
@Security("BearerAuth")
export class OidcClientsController {
	constructor(private readonly auth: AuthService, private readonly clients: OidcClientService, private readonly provider: OidcProviderService) {}

	@Get("/configuration")
	async configuration(@HeaderParams("authorization") authorization?: string) {
		await this.auth.requireAdminSession(authorization);
		return this.provider.getConfiguration();
	}

	@Put("/configuration")
	async updateConfiguration(@BodyParams() request: UpdateOidcConfigurationRequest, @HeaderParams("authorization") authorization?: string) {
		await this.auth.requireAdminSession(authorization);
		return this.provider.setPublicUrl(request.publicUrl);
	}

	@Get("/")
	async list(@HeaderParams("authorization") authorization?: string) {
		await this.auth.requireAdminSession(authorization);
		return this.clients.list();
	}

	@Post("/")
	async create(@BodyParams() request: CreateOidcClientRequest, @Context() ctx: PlatformContext, @HeaderParams("authorization") authorization?: string) {
		await this.auth.requireAdminSession(authorization);
		ctx.response.setHeader("Cache-Control", "no-store");
		return this.clients.create(request);
	}

	@Delete("/:id")
	@Returns(204)
	async remove(@PathParams("id") id: string, @HeaderParams("authorization") authorization?: string) {
		await this.auth.requireAdminSession(authorization);
		await this.clients.remove(id);
	}
}
