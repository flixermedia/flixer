import { Controller } from "@tsed/di";
import { NotFound } from "@tsed/exceptions";
import { BodyParams, HeaderParams, PathParams } from "@tsed/platform-params";
import { Delete, Get, Post, Returns, Security } from "@tsed/schema";
import { PartiesService } from "../../party/partiesService.js";
import { personFrom } from "../../party/partySocketServer.js";
import { AuthService } from "../auth/authService.js";
import { CreatePartyRequest } from "./socialRequests.js";

const partyId = (value: string): string => {
	if (!/^[A-Za-z0-9_-]{8}$/.test(value)) {
		throw new NotFound("This party has ended.");
	}
	return value;
};

/** Watch and listen parties: the host's playback is mirrored for everyone who joins. Live sync runs over /api/party. */
@Controller("/parties")
@Security("BearerAuth")
export class PartiesController {
	constructor(
		private readonly authService: AuthService,
		private readonly parties: PartiesService,
	) {}

	@Post("/")
	@Returns(201)
	async create(@BodyParams() request: CreatePartyRequest, @HeaderParams("authorization") authorization?: string) {
		const user = await this.authService.getAuthenticatedUser(authorization);
		if (!AuthService.isUuid(request.itemId)) {
			throw new NotFound("Media item not found.");
		}
		return this.parties.create(personFrom(user), request.itemId.toLowerCase(), request.visibility ?? "public");
	}

	@Get("/:id")
	async get(@PathParams("id") id: string, @HeaderParams("authorization") authorization?: string) {
		const user = await this.authService.getAuthenticatedUser(authorization);
		return this.parties.get(partyId(id), user.id);
	}

	@Delete("/:id")
	@Returns(204)
	async end(@PathParams("id") id: string, @HeaderParams("authorization") authorization?: string) {
		const user = await this.authService.getAuthenticatedUser(authorization);
		this.parties.endBy(partyId(id), user.id);
	}
}
