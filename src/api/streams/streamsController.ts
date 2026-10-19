import { Controller } from "@tsed/di";
import { HeaderParams, PathParams } from "@tsed/platform-params";
import { Delete, Get, Returns, Security } from "@tsed/schema";
import { StreamsService } from "./streamsService.js";

/** Admin view of the sessions flixer-streamer is currently remuxing or transcoding. */
@Controller("/admin/streams")
@Security("BearerAuth")
export class StreamsController {

	constructor(private readonly streamsService: StreamsService) {}

	@Get("/")
	listSessions(@HeaderParams("authorization") authorization?: string) {
		return this.streamsService.listSessions(authorization);
	}

	@Delete("/:sessionId")
	@Returns(204)
	async cancelSession(@PathParams("sessionId") sessionId: string, @HeaderParams("authorization") authorization?: string) {
		await this.streamsService.cancelSession(sessionId, authorization);
	}
}
