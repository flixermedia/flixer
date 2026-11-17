import { Controller } from "@tsed/di";
import { HeaderParams, QueryParams } from "@tsed/platform-params";
import { Get, Security } from "@tsed/schema";
import { AuthService } from "../auth/authService.ts";
import { DuplicateSuggestionsQuery } from "./duplicateSuggestionsDto.ts";
import { DuplicateSuggestionsService } from "./duplicateSuggestionsService.ts";

@Controller("/admin/media")
@Security("BearerAuth")
export class AdminDuplicateSuggestionsController {
	constructor(
		private readonly authService: AuthService,
		private readonly suggestions: DuplicateSuggestionsService,
	) {}

	@Get("/duplicate-suggestions")
	async list(
		@QueryParams() query: DuplicateSuggestionsQuery,
		@HeaderParams("authorization") authorization?: string,
	) {
		await this.authService.requireAdmin(authorization);
		return this.suggestions.list(query);
	}
}