import { Controller } from "@tsed/di";
import { BodyParams, HeaderParams } from "@tsed/platform-params";
import { Get, Patch, Security } from "@tsed/schema";
import { PreferencesService } from "./preferencesService.js";
import { UpdatePreferencesRequest } from "./updatePreferencesRequest.js";

@Controller("/preferences")
@Security("BearerAuth")
export class PreferencesController {

	constructor(private readonly preferencesService: PreferencesService) {}

	@Get("/")
	get(@HeaderParams("authorization") authorization?: string) {
		return this.preferencesService.get(authorization);
	}

	@Patch("/")
	update(@BodyParams() request: UpdatePreferencesRequest, @HeaderParams("authorization") authorization?: string) {
		return this.preferencesService.update({ ...request }, authorization);
	}
}
