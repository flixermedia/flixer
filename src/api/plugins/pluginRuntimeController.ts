import { Controller } from "@tsed/di";
import { BodyParams, HeaderParams, PathParams, QueryParams } from "@tsed/platform-params";
import { Get, Post, Security } from "@tsed/schema";
import { AuthService } from "../auth/authService.js";
import { PluginSearchService } from "./pluginSearchService.js";
import { PluginPagesService } from "./pluginPagesService.js";
import { PluginWasiRuntime } from "./pluginWasiRuntime.js";
import { PluginSlotService } from "./pluginSlotService.js";

@Controller("/plugins")
@Security("BearerAuth")
export class PluginRuntimeController {
	constructor(
		private readonly authService: AuthService,
		private readonly runtime: PluginWasiRuntime,
		private readonly pages: PluginPagesService,
		private readonly search: PluginSearchService,
		private readonly slots: PluginSlotService,
	) {}

	@Get("/slots")
	async listSlots(@QueryParams("location") location: string, @HeaderParams("authorization") authorization?: string) {
		const user = await this.authService.getUserFromKeyOrSession(authorization);
		return this.slots.list(user.role, location);
	}

	@Get("/:pluginId/slots/:slotId/control")
	async slotControl(@PathParams("pluginId") pluginId: string, @PathParams("slotId") slotId: string, @HeaderParams("authorization") authorization?: string) {
		const user = await this.authService.getUserFromKeyOrSession(authorization);
		return { allowed: await this.slots.canControl(pluginId, slotId, user.role) };
	}

	/** Pages that enabled plugins contribute to the web app's main navigation. */
	@Get("/pages")
	async listPages(@HeaderParams("authorization") authorization?: string) {
		const user = await this.authService.getUserFromKeyOrSession(authorization);
		return this.pages.list(user.role);
	}

	/** Result sections contributed by enabled plugins (for example requestable titles not in the library). */
	@Get("/search")
	async searchSections(
		@QueryParams("q") q: string,
		@QueryParams("type") type?: string,
		@HeaderParams("authorization") authorization?: string,
	) {
		const user = await this.authService.getUserFromKeyOrSession(authorization);
		return { sections: await this.search.search({ id: user.id, role: user.role }, typeof q === "string" ? q : "", type) };
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
