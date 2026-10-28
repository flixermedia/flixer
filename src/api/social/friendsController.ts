import { Controller } from "@tsed/di";
import { BodyParams, HeaderParams, PathParams } from "@tsed/platform-params";
import { Delete, Get, Post, Returns, Security } from "@tsed/schema";
import { AuthService } from "../auth/authService.js";
import { FriendsService } from "./friendsService.js";
import { CreateFriendInviteRequest } from "./socialRequests.js";

/** Friend requests and accepted friendships between users on this server. */
@Controller("/friends")
@Security("BearerAuth")
export class FriendsController {
	constructor(
		private readonly authService: AuthService,
		private readonly friends: FriendsService,
	) {}

	@Get("/")
	async list(@HeaderParams("authorization") authorization?: string) {
		const user = await this.authService.getAuthenticatedUser(authorization);
		return this.friends.list(user.id);
	}

	@Post("/invites/:username")
	async createInvite(
		@PathParams("username") username: string,
		@BodyParams() request: CreateFriendInviteRequest,
		@HeaderParams("authorization") authorization?: string,
	) {
		const user = await this.authService.getAuthenticatedUser(authorization);
		return this.friends.createInvite(user.id, username, request);
	}

	@Get("/invites/:token")
	async getInvite(@PathParams("token") token: string, @HeaderParams("authorization") authorization?: string) {
		const user = await this.authService.getAuthenticatedUser(authorization);
		return this.friends.getInvite(user.id, token);
	}

	@Post("/invites/:token/accept")
	async acceptInvite(@PathParams("token") token: string, @HeaderParams("authorization") authorization?: string) {
		const user = await this.authService.getAuthenticatedUser(authorization);
		return this.friends.acceptInvite(user.id, token);
	}

	@Post("/:username")
	async request(@PathParams("username") username: string, @HeaderParams("authorization") authorization?: string) {
		const user = await this.authService.getAuthenticatedUser(authorization);
		return this.friends.request(user.id, username);
	}

	@Post("/:username/accept")
	async accept(@PathParams("username") username: string, @HeaderParams("authorization") authorization?: string) {
		const user = await this.authService.getAuthenticatedUser(authorization);
		return this.friends.accept(user.id, username);
	}

	@Delete("/:username")
	@Returns(204)
	async remove(@PathParams("username") username: string, @HeaderParams("authorization") authorization?: string) {
		const user = await this.authService.getAuthenticatedUser(authorization);
		await this.friends.remove(user.id, username);
	}
}
