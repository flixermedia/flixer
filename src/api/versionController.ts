import { Controller } from "@tsed/di";
import { Get } from "@tsed/schema";
import { version } from "../config/config.js";

@Controller("/version")
export class VersionController {

	@Get("/")
	get() {
		return { version };
	}
}
