import { Controller } from "@tsed/di";
import { BadRequest } from "@tsed/exceptions";
import { HeaderParams, PathParams, RawBodyParams } from "@tsed/platform-params";
import { Get, Post } from "@tsed/schema";
import { MediaLibrariesService } from "../mediaLibraries/mediaLibrariesService.js";
import { INDEXER_SIGNATURE_HEADER, INDEXER_TIMESTAMP_HEADER, verifyIndexerRequest } from "./indexerAuth.js";
import { IndexerSettingsService } from "./indexerSettingsService.js";
import { MediaItemsService, parseItemPayload } from "./mediaItemsService.js";
import { indexerWriteLimiter } from "./workLimiter.js";

const PREFIX = "/api/indexer";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * The API flixer-indexer calls: which libraries to scan, how to behave, and where to save what it finds.
 * Requests are signed with the shared APP_SECRET (see indexerAuth.ts), not with a user token.
 */
@Controller("/indexer")
export class IndexerApiController {

	private readonly writes = indexerWriteLimiter();

	constructor(
		private readonly libraries: MediaLibrariesService,
		private readonly settings: IndexerSettingsService,
		private readonly items: MediaItemsService,
	) {}

	@Get("/libraries")
	async listLibraries(
		@HeaderParams(INDEXER_TIMESTAMP_HEADER) timestamp?: string,
		@HeaderParams(INDEXER_SIGNATURE_HEADER) signature?: string,
	) {
		verifyIndexerRequest({ method: "GET", path: `${PREFIX}/libraries`, body: new Uint8Array(), timestamp, signature });
		return { libraries: await this.libraries.forIndexer() };
	}

	@Get("/settings")
	async getSettings(
		@HeaderParams(INDEXER_TIMESTAMP_HEADER) timestamp?: string,
		@HeaderParams(INDEXER_SIGNATURE_HEADER) signature?: string,
	) {
		verifyIndexerRequest({ method: "GET", path: `${PREFIX}/settings`, body: new Uint8Array(), timestamp, signature });
		return this.settings.forIndexer();
	}

	/** Creates or updates an item. The body is read raw because the signature covers its exact bytes. */
	@Post("/media/items")
	async upsertItem(
		@RawBodyParams() raw: Buffer | string | undefined,
		@HeaderParams(INDEXER_TIMESTAMP_HEADER) timestamp?: string,
		@HeaderParams(INDEXER_SIGNATURE_HEADER) signature?: string,
	) {
		const body = Buffer.from(raw ?? "");
		verifyIndexerRequest({ method: "POST", path: `${PREFIX}/media/items`, body, timestamp, signature });

		let parsed: unknown;
		try {
			parsed = JSON.parse(body.toString("utf8"));
		} catch {
			throw new BadRequest("The request body must be valid JSON.");
		}
		return this.writes.run(() => this.items.upsert(parseItemPayload(parsed)));
	}

	/** Called when a scan finishes cleanly: removes the library's items that scan did not find. */
	@Post("/libraries/:id/prune")
	async pruneLibrary(
		@PathParams("id") id: string,
		@RawBodyParams() raw: Buffer | string | undefined,
		@HeaderParams(INDEXER_TIMESTAMP_HEADER) timestamp?: string,
		@HeaderParams(INDEXER_SIGNATURE_HEADER) signature?: string,
	) {
		const body = Buffer.from(raw ?? "");
		verifyIndexerRequest({ method: "POST", path: `${PREFIX}/libraries/${id}/prune`, body, timestamp, signature });

		let parsed: unknown;
		try {
			parsed = JSON.parse(body.toString("utf8"));
		} catch {
			throw new BadRequest("The request body must be valid JSON.");
		}
		const startedAt = typeof (parsed as { scanStartedAt?: unknown } | null)?.scanStartedAt === "string" ? new Date((parsed as { scanStartedAt: string }).scanStartedAt) : null;
		if (!UUID_PATTERN.test(id) || !startedAt || Number.isNaN(startedAt.getTime())) {
			throw new BadRequest("A library id and scanStartedAt are required.");
		}
		return this.items.prune(id.toLowerCase(), startedAt);
	}
}
