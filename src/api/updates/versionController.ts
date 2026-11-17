import { Controller } from "@tsed/di";
import { Get } from "@tsed/schema";
import { runtimeVersion } from "../../config/runtimeVersion.ts";

@Controller("/version")
export class VersionController {

	@Get("/")
	get() {
		return { version: runtimeVersion() };
	}
}
