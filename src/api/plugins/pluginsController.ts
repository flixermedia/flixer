import { Controller } from "@tsed/di";
import { BodyParams, HeaderParams, PathParams, QueryParams } from "@tsed/platform-params";
import { Delete, Get, Post, Put, Returns, Security } from "@tsed/schema";
import { AuthService } from "../auth/authService.js";
import {
	type AddPluginRepositoryRequest,
	type InstallPluginRequest,
	PluginCatalogFilter,
	PluginManagerService,
} from "./pluginManagerService.js";
import { PluginSettingsService, type PluginSettingsUpdate } from "./pluginSettingsService.js";

@Controller("/admin/plugins")
@Security("BearerAuth")
export class PluginsController {
	constructor(
		private readonly authService: AuthService,
		private readonly plugins: PluginManagerService,
		private readonly pluginSettings: PluginSettingsService,
	) {}

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

	@Get("/:id/settings")
	async pluginSettingsView(@PathParams("id") id: string, @HeaderParams("authorization") authorization?: string) {
		await this.authService.requireAdmin(authorization);
		return this.pluginSettings.get(id);
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
