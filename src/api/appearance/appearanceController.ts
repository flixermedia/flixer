import { Controller } from "@tsed/di";
import { BodyParams, Context, HeaderParams, PathParams, QueryParams } from "@tsed/platform-params";
import type { PlatformContext } from "@tsed/platform-http";
import { Delete, Get, Post, Put, Returns, Security } from "@tsed/schema";
import { AppearanceService } from "./appearanceService.js";

/** The theme every visitor needs before signing in. No authentication: it only holds cosmetic data. */
@Controller("/appearance")
export class AppearanceController {
	constructor(private readonly appearance: AppearanceService) {}

	@Get("/")
	state() {
		return this.appearance.publicState();
	}

	@Get("/manifest.webmanifest")
	async manifest(@QueryParams("theme") theme: string | undefined, @Context() ctx: PlatformContext) {
		ctx.response.setHeader("Content-Type", "application/manifest+json");
		ctx.response.setHeader("Cache-Control", "no-cache");
		return this.appearance.manifest(theme);
	}

	@Get("/icon/:id")
	async icon(@PathParams("id") id: string, @Context() ctx: PlatformContext) {
		const data = await this.appearance.icon(id);
		ctx.response.setHeader("Content-Type", "image/png");
		ctx.response.setHeader("Cache-Control", "public, max-age=3600");
		ctx.response.setHeader("X-Content-Type-Options", "nosniff");
		return data;
	}
}

@Controller("/admin/appearance")
@Security("BearerAuth")
export class AdminAppearanceController {
	constructor(private readonly appearance: AppearanceService) {}

	@Get("/")
	state(@HeaderParams("authorization") authorization?: string) {
		return this.appearance.adminState(authorization);
	}

	@Put("/settings")
	saveSettings(@BodyParams() body: unknown, @HeaderParams("authorization") authorization?: string) {
		return this.appearance.saveSettings(body, authorization);
	}

	@Post("/themes")
	create(@BodyParams() body: unknown, @HeaderParams("authorization") authorization?: string) {
		return this.appearance.create(body, authorization);
	}

	@Post("/import/preview")
	previewImport(@BodyParams() body: unknown, @HeaderParams("authorization") authorization?: string) {
		return this.appearance.previewImport(body, authorization);
	}

	@Post("/import")
	importTheme(@BodyParams() body: unknown, @HeaderParams("authorization") authorization?: string) {
		return this.appearance.importTheme(body, authorization);
	}

	@Put("/themes/:id")
	update(@PathParams("id") id: string, @BodyParams() body: unknown, @HeaderParams("authorization") authorization?: string) {
		return this.appearance.update(id, body, authorization);
	}

	@Post("/themes/:id/duplicate")
	duplicate(@PathParams("id") id: string, @HeaderParams("authorization") authorization?: string) {
		return this.appearance.duplicate(id, authorization);
	}

	@Get("/themes/:id/versions")
	versions(@PathParams("id") id: string, @HeaderParams("authorization") authorization?: string) {
		return this.appearance.listVersions(id, authorization);
	}

	@Post("/themes/:id/versions/:versionId/restore")
	restoreVersion(@PathParams("id") id: string, @PathParams("versionId") versionId: string, @HeaderParams("authorization") authorization?: string) {
		return this.appearance.restoreVersion(id, versionId, authorization);
	}

	@Get("/themes/:id/export")
	exportTheme(@PathParams("id") id: string, @HeaderParams("authorization") authorization?: string) {
		return this.appearance.exportTheme(id, authorization);
	}

	@Delete("/themes/:id")
	@Returns(204)
	async remove(@PathParams("id") id: string, @HeaderParams("authorization") authorization?: string) {
		await this.appearance.remove(id, authorization);
	}
}
