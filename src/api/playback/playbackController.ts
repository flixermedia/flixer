import { Controller } from "@tsed/di";
import { NotFound } from "@tsed/exceptions";
import { HeaderParams, PathParams } from "@tsed/platform-params";
import { Get, Post, Security } from "@tsed/schema";
import { AuthService } from "../auth/authService.js";
import { PlaybackService } from "./playbackService.js";

@Controller("/playback")
export class PlaybackController {

	constructor(private readonly playbackService: PlaybackService) {}

	@Get("/samples")
	@Security("BearerAuth")
	listSamples(@HeaderParams("authorization") authorization?: string) {
		return this.playbackService.listSamples(authorization);
	}

	@Post("/items/:id/playback-info")
	@Security("BearerAuth")
	itemPlaybackInfo(@PathParams("id") id: string, @HeaderParams("authorization") authorization?: string) {
		if (!AuthService.isUuid(id)) {
			throw new NotFound("Media item not found.");
		}
		return this.playbackService.createItemPlaybackInfo(id.toLowerCase(), authorization);
	}

	@Post("/samples/:id/playback-info")
	@Security("BearerAuth")
	playbackInfo(@PathParams("id") id: string, @HeaderParams("authorization") authorization?: string) {
		return this.playbackService.createPlaybackInfo(id, authorization);
	}
}
