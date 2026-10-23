import { Controller } from "@tsed/di";
import { NotFound } from "@tsed/exceptions";
import { HeaderParams, PathParams } from "@tsed/platform-params";
import { Get } from "@tsed/schema";
import { indexerRuntimeConfig, internalConfigPath, isInternalConfigService } from "../../bootstrap/internalConfig.js";
import { INDEXER_SIGNATURE_HEADER, INDEXER_TIMESTAMP_HEADER, verifyIndexerRequest } from "../indexer/indexerAuth.js";

/** Runtime configuration for the other Flixer services, signed with the shared STREAM_TOKEN_SECRET like the rest of the indexer API. */
@Controller("/internal/config")
export class InternalConfigController {

	@Get("/:service")
	get(
		@PathParams("service") service: string,
		@HeaderParams(INDEXER_TIMESTAMP_HEADER) timestamp?: string,
		@HeaderParams(INDEXER_SIGNATURE_HEADER) signature?: string,
	) {
		if (!isInternalConfigService(service)) {
			throw new NotFound("Unknown service.");
		}
		verifyIndexerRequest({ method: "GET", path: internalConfigPath(service), body: new Uint8Array(), timestamp, signature });
		return indexerRuntimeConfig();
	}
}
