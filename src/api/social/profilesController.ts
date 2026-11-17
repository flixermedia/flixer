import { Controller } from "@tsed/di";
import { NotFound } from "@tsed/exceptions";
import { BodyParams, HeaderParams, PathParams, QueryParams } from "@tsed/platform-params";
import { Get, Post, Put, Returns, Security } from "@tsed/schema";
import { MediaAccessService } from "../access/mediaAccessService.js";
import { AuthService } from "../auth/authService.js";
import { PartiesService } from "../../party/partiesService.js";
import { ProfilesService } from "./profilesService.js";
import { ListeningReportRequest, UpdateProfileVisibilityRequest } from "./socialRequests.js";

/** Profiles visible according to each user's privacy setting. */
@Controller("/profiles")
@Security("BearerAuth")
export class ProfilesController {
	constructor(
		private readonly authService: AuthService,
		private readonly profiles: ProfilesService,
		private readonly parties: PartiesService,
		private readonly access: MediaAccessService,
	) {}

	@Get("/")
	async directory(@QueryParams("q") q?: string, @HeaderParams("authorization") authorization?: string) {
		const user = await this.authService.getAuthenticatedUser(authorization);
		return this.profiles.directory(user.id, typeof q === "string" ? q : undefined);
	}

	@Get("/me")
	async me(@HeaderParams("authorization") authorization?: string) {
		const user = await this.authService.getAuthenticatedUser(authorization);
		return this.profiles.ownProfile(user.id);
	}

	@Put("/me")
	async setVisibility(
		@BodyParams() request: UpdateProfileVisibilityRequest,
		@HeaderParams("authorization") authorization?: string,
	) {
		const user = await this.authService.getAuthenticatedUser(authorization);
		return this.profiles.setVisibility(user.id, request.visibility);
	}

	@Post("/me/listening")
	@Returns(204)
	async listening(
		@BodyParams() request: ListeningReportRequest,
		@HeaderParams("authorization") authorization?: string,
	) {
		const user = await this.authService.getAuthenticatedUser(authorization);
		if (!AuthService.isUuid(request.itemId)) {
			throw new NotFound("Song not found.");
		}
		const position = Number.isFinite(request.positionSeconds)
			? Math.max(0, Math.round(request.positionSeconds as number))
			: 0;
		await this.profiles.reportListening(user.id, request.itemId.toLowerCase(), request.state, position);
	}

	@Get("/:username")
	async get(@PathParams("username") username: string, @HeaderParams("authorization") authorization?: string) {
		const policy = await this.access.resolve(authorization);
		const user = { id: policy.userId };
		const raw = await this.profiles.profile(user.id, username);
		const ids = [...raw.recentlyWatched, ...raw.recentlyListened, ...raw.favorites].map((item) => item.id);
		const visible = await this.access.visibleIds(policy, ids);
		const keep = <T extends { id: string }>(items: T[]) => items.filter((item) => visible.has(item.id));
		const profile = { ...raw, recentlyWatched: keep(raw.recentlyWatched), recentlyListened: keep(raw.recentlyListened), favorites: keep(raw.favorites) };
		return { ...profile, party: await this.parties.hostedByUsername(profile.username, user.id) };
	}
}
