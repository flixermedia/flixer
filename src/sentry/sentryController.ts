import { Controller } from "@tsed/di";
import { NotFound } from "@tsed/exceptions";
import { PathParams } from "@tsed/platform-params";
import { Get } from "@tsed/schema";
import { isSentryApp, SentryService } from "./sentryService.js";

/** Lets flixer-web and flixer-streamer discover whether Sentry is enabled and which DSN to use. */
@Controller("/sentry")
export class SentryController {

	constructor(private readonly sentryService: SentryService) {}

	@Get("/config/:app")
	async getConfig(@PathParams("app") app: string) {
		if (!isSentryApp(app)) {
			throw new NotFound("Unknown app.");
		}

		return this.sentryService.getConfig(app);
	}
}
