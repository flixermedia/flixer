import { Controller } from "@tsed/di";
import { NotFound } from "@tsed/exceptions";
import { BodyParams, HeaderParams, PathParams } from "@tsed/platform-params";
import { Delete, Get, Patch, Post, Put, Returns, Security } from "@tsed/schema";
import { AuthService } from "../auth/authService.js";
import { PlaylistsService } from "./playlistsService.js";
import { CreatePlaylistRequest, PlaylistItemRequest, PlaylistOrderRequest, UpdatePlaylistRequest } from "./socialRequests.js";

const uuid = (value: string, what = "Playlist"): string => {
	if (!AuthService.isUuid(value)) {
		throw new NotFound(`${what} not found.`);
	}
	return value.toLowerCase();
};

/** Song playlists. Owners manage them; others can open public ones. */
@Controller("/playlists")
@Security("BearerAuth")
export class PlaylistsController {

	constructor(
		private readonly authService: AuthService,
		private readonly playlists: PlaylistsService,
	) {}

	@Get("/")
	async list(@HeaderParams("authorization") authorization?: string) {
		const user = await this.authService.getAuthenticatedUser(authorization);
		return { playlists: await this.playlists.listOwn(user.id) };
	}

	@Post("/")
	async create(@BodyParams() request: CreatePlaylistRequest, @HeaderParams("authorization") authorization?: string) {
		const user = await this.authService.getAuthenticatedUser(authorization);
		return this.playlists.create(user.id, request);
	}

	@Get("/containing/:itemId")
	async containing(@PathParams("itemId") itemId: string, @HeaderParams("authorization") authorization?: string) {
		const user = await this.authService.getAuthenticatedUser(authorization);
		return { playlistIds: await this.playlists.containing(user.id, uuid(itemId, "Song")) };
	}

	@Get("/:id")
	async get(@PathParams("id") id: string, @HeaderParams("authorization") authorization?: string) {
		const user = await this.authService.getAuthenticatedUser(authorization);
		return this.playlists.get(user.id, uuid(id));
	}

	@Patch("/:id")
	async update(@PathParams("id") id: string, @BodyParams() request: UpdatePlaylistRequest, @HeaderParams("authorization") authorization?: string) {
		const user = await this.authService.getAuthenticatedUser(authorization);
		return this.playlists.update(user.id, uuid(id), request);
	}

	@Delete("/:id")
	@Returns(204)
	async remove(@PathParams("id") id: string, @HeaderParams("authorization") authorization?: string) {
		const user = await this.authService.getAuthenticatedUser(authorization);
		await this.playlists.remove(user.id, uuid(id));
	}

	@Post("/:id/items")
	@Returns(204)
	async addTrack(@PathParams("id") id: string, @BodyParams() request: PlaylistItemRequest, @HeaderParams("authorization") authorization?: string) {
		const user = await this.authService.getAuthenticatedUser(authorization);
		await this.playlists.addTrack(user.id, uuid(id), uuid(request.itemId, "Song"));
	}

	@Delete("/:id/items/:itemId")
	@Returns(204)
	async removeTrack(@PathParams("id") id: string, @PathParams("itemId") itemId: string, @HeaderParams("authorization") authorization?: string) {
		const user = await this.authService.getAuthenticatedUser(authorization);
		await this.playlists.removeTrack(user.id, uuid(id), uuid(itemId, "Song"));
	}

	@Put("/:id/order")
	@Returns(204)
	async reorder(@PathParams("id") id: string, @BodyParams() request: PlaylistOrderRequest, @HeaderParams("authorization") authorization?: string) {
		const user = await this.authService.getAuthenticatedUser(authorization);
		await this.playlists.reorder(user.id, uuid(id), request.itemIds.map((itemId) => uuid(itemId, "Song")));
	}
}
