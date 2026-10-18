import { Controller } from "@tsed/di";
import { BodyParams, HeaderParams, PathParams } from "@tsed/platform-params";
import { Get, Put, Security } from "@tsed/schema";
import { SettingRequest } from "./settingRequest.js";
import { SettingsService } from "./settingsService.js";

@Controller("/settings")
export class SettingsController {

	constructor(private readonly settingsService: SettingsService) {}

	@Get("/")
	@Security("BearerAuth")
	list(@HeaderParams("authorization") authorization?: string) {
		return this.settingsService.list(authorization);
	}

	@Get("/registration")
	registrationStatus() {
		return this.settingsService.getRegistrationStatus();
	}

	@Put("/:key")
	@Security("BearerAuth")
	update(
		@PathParams("key") key: string,
		@BodyParams() request: SettingRequest,
		@HeaderParams("authorization") authorization?: string,
	) {
		return this.settingsService.update(key, request, authorization);
	}
}
