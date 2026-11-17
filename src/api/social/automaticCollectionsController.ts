import { Controller } from "@tsed/di";
import { HeaderParams, PathParams } from "@tsed/platform-params";
import { Get, Security } from "@tsed/schema";
import { MediaAccessService } from "../access/mediaAccessService.ts";
import { AutomaticCollectionsService } from "./automaticCollectionsService.ts";

@Controller("/user-media/automatic-collections")
@Security("BearerAuth")
export class AutomaticCollectionsController {
	constructor(private readonly collections: AutomaticCollectionsService, private readonly access: MediaAccessService) {}

	@Get("/")
	async list(@HeaderParams("authorization") authorization?: string) {
		return { collections: await this.collections.list(await this.access.resolve(authorization)) };
	}

	@Get("/:id")
	async get(@PathParams("id") id: string, @HeaderParams("authorization") authorization?: string) {
		return this.collections.get(await this.access.resolve(authorization), id);
	}
}