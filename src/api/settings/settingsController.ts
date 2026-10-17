import { Controller } from "@tsed/di";
import { BodyParams, HeaderParams, PathParams } from "@tsed/platform-params";
import { Get, Put, Security } from "@tsed/schema";
import { SettingRequest } from "./settingRequest.js";
import { SettingsService } from "./settingsService.js";

@Controller("/settings")
@Security("BearerAuth")
export class SettingsController {

	constructor(private readonly settingsService: SettingsService) {}

	@Get("/")
	list(@HeaderParams("authorization") authorization?: string) {
		return this.settingsService.list(authorization);
	}

	@Put("/:key")
	update(
		@PathParams("key") key: string,
		@BodyParams() request: SettingRequest,
		@HeaderParams("authorization") authorization?: string,
	) {
		return this.settingsService.update(key, request, authorization);
	}
}
