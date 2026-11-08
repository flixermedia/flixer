import { Controller } from "@tsed/di";
import { BadRequest, NotFound } from "@tsed/exceptions";
import { HeaderParams, PathParams, QueryParams, RawBodyParams } from "@tsed/platform-params";
import { Get, Post } from "@tsed/schema";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { MediaLibrariesService } from "../mediaLibraries/mediaLibrariesService.js";
import { INDEXER_SIGNATURE_HEADER, INDEXER_TIMESTAMP_HEADER, verifyIndexerRequest } from "./indexerAuth.js";
import { IndexerSettingsService } from "./indexerSettingsService.js";
import { IndexerIntroSegmentsService, parseIntroSegmentUpdate } from "./indexerIntroSegmentsService.js";
import { MediaItemsService, parseItemPayload, type IndexerPathRemoval } from "./mediaItemsService.js";
import { indexerWriteLimiter } from "./workLimiter.js";
import { MediaSearchService } from "../media/mediaSearchService.js";
import { MEDIA_ITEM_TYPES, type MediaItemType } from "../../entities/mediaItem.entity.js";

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
		private readonly introSegments: IndexerIntroSegmentsService,
		private readonly mediaSearch: MediaSearchService,
	) {}

	@Get("/libraries")
	async listLibraries(@HeaderParams(INDEXER_TIMESTAMP_HEADER) timestamp?: string, @HeaderParams(INDEXER_SIGNATURE_HEADER) signature?: string) {
		verifyIndexerRequest({
			method: "GET",
			path: `${PREFIX}/libraries`,
			body: new Uint8Array(),
			timestamp,
			signature,
		});
		return { libraries: await this.libraries.forIndexer() };
	}

	@Get("/settings")
	async getSettings(@HeaderParams(INDEXER_TIMESTAMP_HEADER) timestamp?: string, @HeaderParams(INDEXER_SIGNATURE_HEADER) signature?: string) {
		verifyIndexerRequest({
			method: "GET",
			path: `${PREFIX}/settings`,
			body: new Uint8Array(),
			timestamp,
			signature,
		});
		return this.settings.forIndexer();
	}

	@Post("/media/manual-match")
	async manualMatch(@RawBodyParams() raw: Buffer | string | undefined, @HeaderParams(INDEXER_TIMESTAMP_HEADER) timestamp?: string, @HeaderParams(INDEXER_SIGNATURE_HEADER) signature?: string) {
		const body = Buffer.from(raw ?? "");
		verifyIndexerRequest({ method: "POST", path: `${PREFIX}/media/manual-match`, body, timestamp, signature });
		let value: unknown;
		try {
			value = JSON.parse(body.toString("utf8"));
		} catch {
			throw new BadRequest("The request body must be valid JSON.");
		}
		if (!value || typeof value !== "object" || Array.isArray(value)) throw new BadRequest("Invalid match request.");
		const request = value as Record<string, unknown>;
		if (typeof request.libraryId !== "string" || !UUID_PATTERN.test(request.libraryId) ||
			typeof request.type !== "string" || !(MEDIA_ITEM_TYPES as readonly string[]).includes(request.type) ||
			typeof request.path !== "string" || !request.path || request.path.length > 4096) {
			throw new BadRequest("Invalid match request.");
		}
		return { providerIds: await this.items.manualMatch(request.libraryId.toLowerCase(), request.type as MediaItemType, request.path) };
	}

	/** Creates or updates an item. The body is read raw because the signature covers its exact bytes. */
	@Post("/media/items")
	async upsertItem(@RawBodyParams() raw: Buffer | string | undefined, @HeaderParams(INDEXER_TIMESTAMP_HEADER) timestamp?: string, @HeaderParams(INDEXER_SIGNATURE_HEADER) signature?: string) {
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

	/** Stores lyrics separately from media metadata so they can be rebuilt into the search index. */
	@Post("/media/items/:id/lyrics")
	async upsertItemLyrics(@PathParams("id") id: string, @RawBodyParams() raw: Buffer | string | undefined, @HeaderParams(INDEXER_TIMESTAMP_HEADER) timestamp?: string, @HeaderParams(INDEXER_SIGNATURE_HEADER) signature?: string) {
		const body = Buffer.from(raw ?? "");
		verifyIndexerRequest({
			method: "POST",
			path: `${PREFIX}/media/items/${id}/lyrics`,
			body,
			timestamp,
			signature,
		});
		if (!UUID_PATTERN.test(id)) throw new BadRequest("id must be a media item id.");
		let parsed: unknown;
		try {
			parsed = JSON.parse(body.toString("utf8"));
		} catch {
			throw new BadRequest("The request body must be valid JSON.");
		}
		if (typeof parsed !== "object" || parsed === null || typeof (parsed as { lyrics?: unknown }).lyrics !== "string") {
			throw new BadRequest("lyrics must be text.");
		}
		await this.writes.run(() => this.mediaSearch.storeTrackLyrics(id.toLowerCase(), (parsed as { lyrics: string }).lyrics));
		return { ok: true };
	}

	@Get("/media/intro-sync")
	async introSyncCandidates(@QueryParams("type", String) type?: string, @QueryParams("libraryId", String) libraryId?: string, @QueryParams("afterId", String) afterId?: string, @QueryParams("limit", Number) limit?: number, @HeaderParams(INDEXER_TIMESTAMP_HEADER) timestamp?: string, @HeaderParams(INDEXER_SIGNATURE_HEADER) signature?: string) {
		verifyIndexerRequest({
			method: "GET",
			path: `${PREFIX}/media/intro-sync`,
			body: new Uint8Array(),
			timestamp,
			signature,
		});
		if (type !== "movie" && type !== "episode") {
			throw new BadRequest('type must be "movie" or "episode".');
		}
		if (libraryId !== undefined && !UUID_PATTERN.test(libraryId)) {
			throw new BadRequest("libraryId must be a library id.");
		}
		const pageSize = limit ?? 100;
		if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 500) {
			throw new BadRequest("limit must be a whole number between 1 and 500.");
		}
		return this.introSegments.candidates(type, afterId, pageSize, libraryId?.toLowerCase());
	}

	@Get("/media/intro-segments")
	async existingIntroSegments(@QueryParams("itemId", String) itemId?: string, @HeaderParams(INDEXER_TIMESTAMP_HEADER) timestamp?: string, @HeaderParams(INDEXER_SIGNATURE_HEADER) signature?: string) {
		verifyIndexerRequest({
			method: "GET",
			path: `${PREFIX}/media/intro-segments`,
			body: new Uint8Array(),
			timestamp,
			signature,
		});
		if (!itemId || !UUID_PATTERN.test(itemId)) {
			throw new BadRequest("itemId must be a media item id.");
		}
		return { segments: await this.introSegments.existing(itemId.toLowerCase()) };
	}

	/** Replaces TheIntroDB-owned timings for an indexed media item. */
	@Post("/media/intro-segments")
	async updateIntroSegments(@RawBodyParams() raw: Buffer | string | undefined, @HeaderParams(INDEXER_TIMESTAMP_HEADER) timestamp?: string, @HeaderParams(INDEXER_SIGNATURE_HEADER) signature?: string) {
		const body = Buffer.from(raw ?? "");
		verifyIndexerRequest({ method: "POST", path: `${PREFIX}/media/intro-segments`, body, timestamp, signature });
		let parsed: unknown;
		try {
			parsed = JSON.parse(body.toString("utf8"));
		} catch {
			throw new BadRequest("The request body must be valid JSON.");
		}
		await this.introSegments.replace(parseIntroSegmentUpdate(parsed));
		return { ok: true };
	}

	/** Called when a scan finishes cleanly: removes the library's items that scan did not find. */
	@Post("/libraries/:id/prune")
	async pruneLibrary(@PathParams("id") id: string, @RawBodyParams() raw: Buffer | string | undefined, @HeaderParams(INDEXER_TIMESTAMP_HEADER) timestamp?: string, @HeaderParams(INDEXER_SIGNATURE_HEADER) signature?: string) {
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

	/** Removes items at paths which the watcher reports as removed or renamed. */
	@Post("/libraries/:id/remove-paths")
	async removeItemsAtPaths(@PathParams("id") id: string, @RawBodyParams() raw: Buffer | string | undefined, @HeaderParams(INDEXER_TIMESTAMP_HEADER) timestamp?: string, @HeaderParams(INDEXER_SIGNATURE_HEADER) signature?: string) {
		const body = Buffer.from(raw ?? "");
		verifyIndexerRequest({
			method: "POST",
			path: `${PREFIX}/libraries/${id}/remove-paths`,
			body,
			timestamp,
			signature,
		});
		let parsed: unknown;
		try {
			parsed = JSON.parse(body.toString("utf8"));
		} catch {
			throw new BadRequest("The request body must be valid JSON.");
		}
		if (!UUID_PATTERN.test(id) || typeof parsed !== "object" || parsed === null) {
			throw new BadRequest("A library id and removal targets are required.");
		}
		const rawTargets = (parsed as { targets?: unknown }).targets;
		if (!Array.isArray(rawTargets) || rawTargets.length === 0 || rawTargets.length > 500) {
			throw new BadRequest("targets must contain between 1 and 500 paths.");
		}
		const library = (await this.libraries.forIndexer()).find((item) => item.id === id.toLowerCase());
		if (!library) {
			throw new NotFound("Media library not found.");
		}
		const targets: IndexerPathRemoval[] = [];
		const seen = new Set<string>();
		for (const value of rawTargets) {
			if (typeof value !== "object" || value === null || typeof (value as { path?: unknown }).path !== "string" || typeof (value as { recursive?: unknown }).recursive !== "boolean") {
				throw new BadRequest("Each target must have an absolute path and recursive flag.");
			}
			const rawPath = (value as { path: string }).path;
			if (!isAbsolute(rawPath) || rawPath.includes("\0")) {
				throw new BadRequest("Each target path must be absolute.");
			}
			const path = resolve(rawPath);
			const insideLibrary = library.folders.some((folder) => {
				const root = resolve(folder.absolutePath);
				const rel = relative(root, path);
				return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
			});
			if (!insideLibrary) {
				throw new BadRequest("Removal target is outside the library folders.");
			}
			const recursive = (value as { recursive: boolean }).recursive;
			const key = `${path}\0${recursive}`;
			if (!seen.has(key)) {
				seen.add(key);
				targets.push({ path, recursive });
			}
		}
		return this.writes.run(() => this.items.removePaths(id.toLowerCase(), targets));
	}
}
