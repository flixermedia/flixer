import { Controller } from "@tsed/di";
import { HeaderParams } from "@tsed/platform-params";
import { Post, Security } from "@tsed/schema";
import { AuthService } from "../auth/authService.js";
import { MediaSearchService } from "./mediaSearchService.js";

/** Search-index maintenance operations for administrators. */
@Controller("/admin/search")
@Security("BearerAuth")
export class AdminMediaSearchController {
	constructor(
		private readonly authService: AuthService,
		private readonly search: MediaSearchService,
	) {}

	@Post("/rebuild")
	async rebuild(@HeaderParams("authorization") authorization?: string) {
		await this.authService.requireAdmin(authorization);
		return this.search.enqueueRebuild();
	}
}
