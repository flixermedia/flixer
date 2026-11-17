import { Controller } from "@tsed/di";
import { BodyParams, HeaderParams, PathParams } from "@tsed/platform-params";
import { Delete, Get, Post, Put, Returns, Security } from "@tsed/schema";
import { PageBuilderService } from "./pageBuilderService.js";

@Controller("/admin/page-templates")
@Security("BearerAuth")
export class AdminPageTemplatesController {

	constructor(private readonly pages: PageBuilderService) {}
	@Get("/")
	list(@HeaderParams("authorization") authorization?: string) {
		return this.pages.templates(authorization);
	}
	@Post("/")
	create(@BodyParams() body: unknown, @HeaderParams("authorization") authorization?: string) {
		return this.pages.createTemplate(body, authorization);
	}
	@Delete("/:id")
	@Returns(204)
	async remove(@PathParams("id") id: string, @HeaderParams("authorization") authorization?: string) {
		await this.pages.removeTemplate(id, authorization);
	}
}

@Controller("/page-site")
export class PublicPageSiteController {

	constructor(private readonly pages: PageBuilderService) {}
	@Get("/navigation")
	navigation(@HeaderParams("authorization") authorization?: string) {
		return this.pages.navigation(authorization);
	}
	@Get("/home")
	home(@HeaderParams("authorization") authorization?: string) {
		return this.pages.home(authorization);
	}
}

@Controller("/admin/page-site")
@Security("BearerAuth")
export class AdminPageSiteController {

	constructor(private readonly pages: PageBuilderService) {}
	@Get("/")
	state(@HeaderParams("authorization") authorization?: string) {
		return this.pages.adminSite(authorization);
	}
	@Put("/")
	save(@BodyParams() body: unknown, @HeaderParams("authorization") authorization?: string) {
		return this.pages.saveSite(body, authorization);
	}
}

@Controller("/pages")
export class PublicPageBuilderController {

	constructor(private readonly pages: PageBuilderService) {}
	@Get("/:slug")
	page(@PathParams("slug") slug: string, @HeaderParams("authorization") authorization?: string) {
		return this.pages.publicPage(slug, authorization);
	}
}

@Controller("/admin/pages")
@Security("BearerAuth")
export class AdminPageBuilderController {

	constructor(private readonly pages: PageBuilderService) {}
	@Get("/")
	list(@HeaderParams("authorization") authorization?: string) {
		return this.pages.list(authorization);
	}
	@Post("/")
	create(@HeaderParams("authorization") authorization?: string) {
		return this.pages.create(authorization);
	}
	@Put("/:id")
	save(@PathParams("id") id: string, @BodyParams() body: unknown, @HeaderParams("authorization") authorization?: string) {
		return this.pages.save(id, body, authorization);
	}
	@Post("/:id/publish")
	publish(@PathParams("id") id: string, @HeaderParams("authorization") authorization?: string) {
		return this.pages.publish(id, authorization);
	}
	@Post("/:id/unpublish")
	unpublish(@PathParams("id") id: string, @HeaderParams("authorization") authorization?: string) {
		return this.pages.unpublish(id, authorization);
	}
	@Post("/:id/schedule")
	schedule(@PathParams("id") id: string, @BodyParams() body: unknown, @HeaderParams("authorization") authorization?: string) {
		return this.pages.schedule(id, body, authorization);
	}
	@Delete("/:id/schedule")
	cancelSchedule(@PathParams("id") id: string, @HeaderParams("authorization") authorization?: string) {
		return this.pages.cancelSchedule(id, authorization);
	}
	@Post("/:id/versions/:versionId/restore")
	restore(@PathParams("id") id: string, @PathParams("versionId") versionId: string, @HeaderParams("authorization") authorization?: string) {
		return this.pages.restore(id, versionId, authorization);
	}
	@Delete("/:id")
	@Returns(204)
	async remove(@PathParams("id") id: string, @HeaderParams("authorization") authorization?: string) {
		await this.pages.remove(id, authorization);
	}
}
