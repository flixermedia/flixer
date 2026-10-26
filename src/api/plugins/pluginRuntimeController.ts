import { Controller } from "@tsed/di";
import { BodyParams, HeaderParams, PathParams } from "@tsed/platform-params";
import { Get, Post, Security } from "@tsed/schema";
import { AuthService } from "../auth/authService.js";
import { PluginPagesService } from "./pluginPagesService.js";
import { PluginWasiRuntime } from "./pluginWasiRuntime.js";

@Controller("/plugins")
@Security("BearerAuth")
export class PluginRuntimeController {
	constructor(
		private readonly authService: AuthService,
		private readonly runtime: PluginWasiRuntime,
		private readonly pages: PluginPagesService,
	) {}

	/** Pages that enabled plugins contribute to the web app's main navigation. */
	@Get("/pages")
	async listPages(@HeaderParams("authorization") authorization?: string) {
		const user = await this.authService.getUserFromKeyOrSession(authorization);
		return this.pages.list(user.role);
	}

	@Post("/:pluginId/:operation")
	async invoke(
		@PathParams("pluginId") pluginId: string,
		@PathParams("operation") operation: string,
		@BodyParams() body: unknown,
		@HeaderParams("authorization") authorization?: string,
	) {
		const user = await this.authService.getUserFromKeyOrSession(authorization);
		return this.runtime.invoke(pluginId, operation, { id: user.id, role: user.role }, body);
	}
}
