import { Controller } from "@tsed/di";
import { NotFound } from "@tsed/exceptions";
import { Context, HeaderParams, PathParams } from "@tsed/platform-params";
import { Get } from "@tsed/schema";
import { INDEXER_SIGNATURE_HEADER, INDEXER_TIMESTAMP_HEADER, verifyIndexerRequest } from "../indexer/indexerAuth.js";
import { LoggerService, type LoggerProducer } from "./loggerService.js";
import { requireProtectedProducerTransport, type ProducerRequestContext } from "./secureProducerRequest.js";

const producers = {
	indexer: "flixer-indexer",
	streamer: "flixer-streamer",
	updater: "flixer-updater",
} as const satisfies Record<string, LoggerProducer>;

/** Provides application-bound credentials to signed internal producer requests. */
@Controller("/internal/logger")
export class ProducerLoggerController {
	constructor(private readonly logger: LoggerService) {}

	@Get("/:service")
	async configuration(
		@Context() ctx: ProducerRequestContext,
		@PathParams("service") service: string,
		@HeaderParams(INDEXER_TIMESTAMP_HEADER) timestamp?: string,
		@HeaderParams(INDEXER_SIGNATURE_HEADER) signature?: string,
	) {
		ctx.response.setHeader("Cache-Control", "private, no-store");
		if (!Object.hasOwn(producers, service)) throw new NotFound("Unknown logger producer.");
		const app = producers[service as keyof typeof producers];
		verifyIndexerRequest({
			method: "GET", path: `/api/internal/logger/${service}`, body: new Uint8Array(), timestamp, signature,
		});
		requireProtectedProducerTransport(ctx);
		return this.logger.producerIngestConfiguration(app);
	}
}
