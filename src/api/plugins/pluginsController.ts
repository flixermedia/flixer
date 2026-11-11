import { Controller } from "@tsed/di";
import { BadRequest } from "@tsed/exceptions";
import { Middleware, UseBefore } from "@tsed/platform-middlewares";
import { MulterOptions, MultipartFile, type PlatformMulterFile } from "@tsed/platform-multer";
import { BodyParams, Context, HeaderParams, PathParams, QueryParams } from "@tsed/platform-params";
import type { PlatformContext } from "@tsed/platform-http";
import { Delete, Get, Post, Property, Put, Required, Returns, Security } from "@tsed/schema";
import { AuthService } from "../auth/authService.js";
import { ExternalOAuthProfilesService } from "../auth/externalOAuthProfilesService.js";
import { oauthCallbackUrl } from "../auth/externalOAuthProfiles.js";
import {
	type AddPluginRepositoryRequest,
	type InstallPluginRequest,
	PluginCatalogFilter,
	PluginManagerService,
} from "./pluginManagerService.js";
import { MAX_LOCAL_PLUGIN_ARCHIVE_BYTES } from "./pluginManagerService.js";
import { PluginSettingsService, type PluginSettingsUpdate } from "./pluginSettingsService.js";

class LocalPluginImportRequest {
	@Property()
	@Required()
	approvedPermissions!: string;
}

class OAuthProfileSettingsRequest {
	@Property() @Required() authorizationUrl!: string;
	@Property() @Required() tokenUrl!: string;
	@Property() @Required() userInfoUrl!: string;
	@Property() @Required() issuer!: string;
	@Property() @Required() subjectField!: string;
	@Property() @Required() scope!: string;
	@Property() @Required() clientId!: string;
	@Property() @Required() tokenAuthMethod!: "client_secret_post" | "client_secret_basic" | "none";
}

class OAuthProfileRequest {
	@Property() @Required() name!: string;
	@Property() @Required() enabled!: boolean;
	@Property() @Required() settings!: OAuthProfileSettingsRequest;
	@Property() clientSecret?: string;
}

@Middleware({ priority: -100 })
class RequirePluginAdmin {
	constructor(private readonly authService: AuthService) {}
	async use(@HeaderParams("authorization") authorization?: string) {
		await this.authService.requireAdminSession(authorization);
	}
}

@Controller("/admin/plugins")
@Security("BearerAuth")
export class PluginsController {
	constructor(
		private readonly authService: AuthService,
		private readonly plugins: PluginManagerService,
		private readonly pluginSettings: PluginSettingsService,
		private readonly oauthProfiles: ExternalOAuthProfilesService,
	) {}

	@Get("/local-import")
	async localImportStatus(@HeaderParams("authorization") authorization?: string) {
		await this.authService.requireAdminSession(authorization);
		return { enabled: this.plugins.localImportEnabled() };
	}

	@Post("/local-import/preview")
	@UseBefore(RequirePluginAdmin)
	@MulterOptions({ limits: { fileSize: MAX_LOCAL_PLUGIN_ARCHIVE_BYTES, files: 1, fields: 0 } })
	async previewLocalPackage(@MultipartFile("package") file: PlatformMulterFile | undefined) {
		if (!file?.buffer) throw new BadRequest("Choose a plugin package to inspect.");
		return { manifest: await this.plugins.inspectLocalPackage(file.buffer) };
	}

	@Post("/local-import")
	@UseBefore(RequirePluginAdmin)
	@MulterOptions({ limits: { fileSize: MAX_LOCAL_PLUGIN_ARCHIVE_BYTES, files: 1, fields: 1 } })
	async importLocalPackage(
		@MultipartFile("package") file: PlatformMulterFile | undefined,
		@BodyParams() request: LocalPluginImportRequest,
	) {
		if (!file?.buffer) throw new BadRequest("Choose a plugin package to import.");
		const approvedPermissionsJson = request?.approvedPermissions;
		if (typeof approvedPermissionsJson !== "string" || approvedPermissionsJson.length > 16_384) {
			throw new BadRequest("Approved permissions must be a JSON list.");
		}
		let approvedPermissions: unknown;
		try { approvedPermissions = JSON.parse(approvedPermissionsJson); } catch { throw new BadRequest("Approved permissions must be a JSON list."); }
		if (!Array.isArray(approvedPermissions) || !approvedPermissions.every((permission) => typeof permission === "string")) {
			throw new BadRequest("Approved permissions must be a JSON list.");
		}
		return this.plugins.importLocalPackage(file.buffer, approvedPermissions);
	}

	@Get("/")
	async installed(@HeaderParams("authorization") authorization?: string) {
		await this.authService.requireAdmin(authorization);
		return this.plugins.listInstalled();
	}

	@Get("/repositories")
	async repositories(@HeaderParams("authorization") authorization?: string) {
		await this.authService.requireAdmin(authorization);
		return this.plugins.listRepositories();
	}

	@Get("/catalog")
	async catalog(
		@QueryParams("q", String) query: string | undefined,
		@QueryParams("target", String) target: string | undefined,
		@QueryParams("capability", String) capability: string | undefined,
		@HeaderParams("authorization") authorization?: string,
	) {
		await this.authService.requireAdmin(authorization);
		const filter: PluginCatalogFilter = { query, target, capability };
		return this.plugins.discover(filter);
	}

	@Get("/repositories/:id/image")
	async repositoryImage(@PathParams("id") id: string, @QueryParams("path") path: string, @Context() context: PlatformContext, @HeaderParams("authorization") authorization?: string) {
		await this.authService.requireAdminSession(authorization);
		const { data, mime } = await this.plugins.repositoryImage(id, path);
		context.response.setHeader("Content-Type", mime);
		context.response.setHeader("Cache-Control", "private, max-age=300");
		context.response.setHeader("X-Content-Type-Options", "nosniff");
		context.response.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
		return data;
	}

	@Get("/:id/settings")
	async pluginSettingsView(@PathParams("id") id: string, @HeaderParams("authorization") authorization?: string) {
		await this.authService.requireAdmin(authorization);
		return this.pluginSettings.get(id);
	}

	@Get("/:id/oauth-providers")
	async oauthProviderList(@PathParams("id") id: string, @HeaderParams("authorization") authorization?: string) {
		await this.authService.requireAdminSession(authorization);
		return this.oauthProfiles.list(id);
	}

	@Get("/:id/oauth-providers/callback")
	async oauthProviderCallback(@PathParams("id") id: string, @HeaderParams("authorization") authorization?: string) {
		await this.authService.requireAdminSession(authorization);
		await this.oauthProfiles.plugin(id);
		return { callbackUrl: oauthCallbackUrl() };
	}

	@Post("/:id/oauth-providers")
	async createOAuthProvider(@PathParams("id") id: string, @BodyParams() request: OAuthProfileRequest, @HeaderParams("authorization") authorization?: string) {
		await this.authService.requireAdminSession(authorization);
		return this.oauthProfiles.save(id, undefined, request);
	}

	@Put("/:id/oauth-providers/:providerId")
	async updateOAuthProvider(@PathParams("id") id: string, @PathParams("providerId") providerId: string, @BodyParams() request: OAuthProfileRequest, @HeaderParams("authorization") authorization?: string) {
		await this.authService.requireAdminSession(authorization);
		return this.oauthProfiles.save(id, providerId, request);
	}

	@Delete("/:id/oauth-providers/:providerId")
	@Returns(204)
	async deleteOAuthProvider(@PathParams("id") id: string, @PathParams("providerId") providerId: string, @HeaderParams("authorization") authorization?: string) {
		await this.authService.requireAdminSession(authorization);
		await this.oauthProfiles.remove(id, providerId);
	}

	@Get("/:id/history")
	async pluginUpdateHistory(
		@PathParams("id") id: string,
		@QueryParams("limit", Number) limit: number | undefined,
		@HeaderParams("authorization") authorization?: string,
	) {
		await this.authService.requireAdmin(authorization);
		return this.plugins.updateHistory(id, limit ?? 20);
	}

	@Put("/:id/settings")
	async updatePluginSettings(
		@PathParams("id") id: string,
		@BodyParams() request: PluginSettingsUpdate,
		@HeaderParams("authorization") authorization?: string,
	) {
		await this.authService.requireAdmin(authorization);
		return this.pluginSettings.update(id, request);
	}

	@Post("/:id/install")
	async install(
		@PathParams("id") id: string,
		@BodyParams() request: InstallPluginRequest,
		@HeaderParams("authorization") authorization?: string,
	) {
		await this.authService.requireAdmin(authorization);
		return this.plugins.install(id, request);
	}

	@Post("/:id/enable")
	async enable(@PathParams("id") id: string, @HeaderParams("authorization") authorization?: string) {
		await this.authService.requireAdmin(authorization);
		return this.plugins.enable(id);
	}

	@Post("/:id/disable")
	async disable(@PathParams("id") id: string, @HeaderParams("authorization") authorization?: string) {
		await this.authService.requireAdmin(authorization);
		return this.plugins.disable(id);
	}

	@Delete("/:id")
	@Returns(204)
	async uninstall(
		@PathParams("id") id: string,
		@HeaderParams("authorization") authorization?: string,
	): Promise<void> {
		await this.authService.requireAdmin(authorization);
		return this.plugins.uninstall(id);
	}

	@Post("/repositories")
	async addRepository(
		@BodyParams() request: AddPluginRepositoryRequest,
		@HeaderParams("authorization") authorization?: string,
	) {
		await this.authService.requireAdmin(authorization);
		return this.plugins.addRepository(request);
	}

	@Post("/repositories/:id/refresh")
	async refreshRepository(@PathParams("id") id: string, @HeaderParams("authorization") authorization?: string) {
		await this.authService.requireAdmin(authorization);
		return this.plugins.refreshRepository(id);
	}

	@Delete("/repositories/:id")
	@Returns(204)
	async removeRepository(
		@PathParams("id") id: string,
		@HeaderParams("authorization") authorization?: string,
	): Promise<void> {
		await this.authService.requireAdmin(authorization);
		return this.plugins.removeRepository(id);
	}
}
