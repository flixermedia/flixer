import { Controller } from "@tsed/di";
import { BodyParams, HeaderParams, PathParams } from "@tsed/platform-params";
import { Post, Security } from "@tsed/schema";
import { AuthService } from "../auth/authService.js";
import { PluginWasiRuntime } from "./pluginWasiRuntime.js";

@Controller("/plugins")
@Security("BearerAuth")
export class PluginRuntimeController {
	constructor(
		private readonly authService: AuthService,
		private readonly runtime: PluginWasiRuntime,
	) {}

	@Post("/:pluginId/:operation")
	async invoke(
		@PathParams("pluginId") pluginId: string,
		@PathParams("operation") operation: string,
		@BodyParams() body: unknown,
		@HeaderParams("authorization") authorization?: string,
	) {
		const user = await this.authService.getAuthenticatedUser(authorization);
		return this.runtime.invoke(pluginId, operation, { id: user.id, role: user.role }, body);
	}
}
