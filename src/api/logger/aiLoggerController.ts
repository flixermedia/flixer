import { Controller } from "@tsed/di";
import { Context, HeaderParams } from "@tsed/platform-params";
import { Get } from "@tsed/schema";
import { AI_SIGNATURE_HEADER, AI_TIMESTAMP_HEADER, verifyAiRequest } from "../ai/aiAuth.js";
import { LoggerService } from "./loggerService.js";
import { requireProtectedProducerTransport, type ProducerRequestContext } from "./secureProducerRequest.js";

const PATH = "/api/internal/ai/logger-configuration";

/** Provides AI's application-bound ingestion credential to authenticated service instances. */
@Controller("/internal/ai")
export class AiLoggerController {
	constructor(private readonly logger: LoggerService) {}

	@Get("/logger-configuration")
	async configuration(
		@Context() ctx: ProducerRequestContext,
		@HeaderParams(AI_TIMESTAMP_HEADER) timestamp?: string,
		@HeaderParams(AI_SIGNATURE_HEADER) signature?: string,
	) {
		ctx.response.setHeader("Cache-Control", "private, no-store");
		verifyAiRequest({ method: "GET", path: PATH, body: new Uint8Array(), timestamp, signature });
		requireProtectedProducerTransport(ctx);
		return this.logger.producerIngestConfiguration("flixer-ai");
	}
}
