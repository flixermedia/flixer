import { Controller } from "@tsed/di";
import { NotFound } from "@tsed/exceptions";
import type { PlatformContext } from "@tsed/platform-http";
import { Context, HeaderParams, PathParams } from "@tsed/platform-params";
import { Get, Post, Security } from "@tsed/schema";
import { AuthService } from "../auth/authService.js";
import { ThemesService } from "./themesService.js";

/** Theme songs (ThemerrDB) for movies and shows. */
@Controller("/themes")
@Security("BearerAuth")
export class ThemesController {

	constructor(
		private readonly authService: AuthService,
		private readonly themes: ThemesService,
	) {}

	/** A movie's or show's theme as MP3. Authenticated, so the web app fetches it with its token. */
	@Get("/items/:id")
	async audio(
		@PathParams("id") id: string,
		@Context() ctx: PlatformContext,
		@HeaderParams("authorization") authorization?: string,
	) {
		await this.authService.getAuthenticatedUser(authorization);
		if (!AuthService.isUuid(id)) {
			throw new NotFound("This item has no theme song.");
		}
		const data = await this.themes.audio(id.toLowerCase());
		ctx.response.setHeader("Content-Type", "audio/mpeg");
		ctx.response.setHeader("Cache-Control", "private, max-age=86400");
		ctx.response.setHeader("X-Content-Type-Options", "nosniff");
		return data;
	}

	/** Queues theme downloads for everything already in the library. */
	@Post("/sync")
	async sync(@HeaderParams("authorization") authorization?: string) {
		await this.authService.requireAdmin(authorization);
		return this.themes.syncAll();
	}
}
