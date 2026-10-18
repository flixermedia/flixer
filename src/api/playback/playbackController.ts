import { Controller } from "@tsed/di";
import { HeaderParams, PathParams } from "@tsed/platform-params";
import { Get, Post, Security } from "@tsed/schema";
import { PlaybackService } from "./playbackService.js";

@Controller("/playback")
export class PlaybackController {

	constructor(private readonly playbackService: PlaybackService) {}

	@Get("/samples")
	@Security("BearerAuth")
	listSamples(@HeaderParams("authorization") authorization?: string) {
		return this.playbackService.listSamples(authorization);
	}

	@Post("/samples/:id/playback-info")
	@Security("BearerAuth")
	playbackInfo(@PathParams("id") id: string, @HeaderParams("authorization") authorization?: string) {
		return this.playbackService.createPlaybackInfo(id, authorization);
	}
}
