import { Controller } from "@tsed/di";
import { NotFound } from "@tsed/exceptions";
import { HeaderParams, PathParams } from "@tsed/platform-params";
import { Delete, Get, Put, Returns, Security } from "@tsed/schema";
import { MediaAccessService } from "../access/mediaAccessService.js";
import { AuthService } from "../auth/authService.js";
import { FavoritesService } from "./favoritesService.js";

const itemId = (value: string): string => {
	if (!AuthService.isUuid(value)) {
		throw new NotFound("Media item not found.");
	}
	return value.toLowerCase();
};

/** The signed-in user's favourite movies, shows, albums, songs and videos. */
@Controller("/favorites")
@Security("BearerAuth")
export class FavoritesController {

	constructor(
		private readonly authService: AuthService,
		private readonly favorites: FavoritesService,
		private readonly access: MediaAccessService,
	) {}

	@Get("/")
	async list(@HeaderParams("authorization") authorization?: string) {
		const policy = await this.access.resolve(authorization);
		const items = await this.favorites.list(policy.userId);
		const visible = await this.access.visibleIds(policy, items.map((item) => item.id));
		return { items: items.filter((item) => visible.has(item.id)) };
	}

	@Get("/ids")
	async ids(@HeaderParams("authorization") authorization?: string) {
		const user = await this.authService.getAuthenticatedUser(authorization);
		return { ids: await this.favorites.ids(user.id) };
	}

	@Put("/:itemId")
	@Returns(204)
	async add(@PathParams("itemId") id: string, @HeaderParams("authorization") authorization?: string) {
		const user = await this.authService.getAuthenticatedUser(authorization);
		await this.favorites.add(user.id, itemId(id));
	}

	@Delete("/:itemId")
	@Returns(204)
	async remove(@PathParams("itemId") id: string, @HeaderParams("authorization") authorization?: string) {
		const user = await this.authService.getAuthenticatedUser(authorization);
		await this.favorites.remove(user.id, itemId(id));
	}
}
