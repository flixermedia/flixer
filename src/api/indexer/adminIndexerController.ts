import { Controller } from "@tsed/di";
import { BadRequest, NotFound } from "@tsed/exceptions";
import { BodyParams, HeaderParams, PathParams, QueryParams } from "@tsed/platform-params";
import { Get, Post, Put, Security } from "@tsed/schema";
import { AuthService } from "../auth/authService.js";
import { IndexerClient } from "./indexerClient.js";
import { INDEXER_QUEUES } from "./indexerSettingsService.js";
import { AdminIndexerService } from "./adminIndexerService.js";
import { MEDIA_ITEM_TYPES } from "../../entities/mediaItem.entity.js";
import { RefreshItemRequest, ScanLibraryRequest } from "./indexerRequests.js";
import { LiveService } from "../../live/liveService.js";

const TASK_ID_PATTERN = /^[A-Za-z0-9-]{1,64}$/;
const TASK_STATES = ["pending", "active", "scheduled", "retry", "archived", "completed"];

/** Starts and monitors media scans by driving flixer-indexer's internal API. */
@Controller("/admin/indexer")
@Security("BearerAuth")
export class AdminIndexerController {

	constructor(
		private readonly authService: AuthService,
		private readonly indexer: IndexerClient,
		private readonly admin: AdminIndexerService,
		private readonly live: LiveService,
	) {}

	/** Everything the indexer dashboard shows: scan progress, queue stats and worker counts. */
	@Get("/status")
	async status(@HeaderParams("authorization") authorization?: string) {
		await this.authService.requireAdmin(authorization);
		return this.admin.status();
	}

	@Post("/libraries/:id/scan")
	async scan(
		@PathParams("id") id: string,
		@BodyParams() request: ScanLibraryRequest,
		@HeaderParams("authorization") authorization?: string,
	) {
		await this.authService.requireAdmin(authorization);
		if (!AuthService.isUuid(id)) {
			throw new NotFound("Media library not found.");
		}
		const result = await this.indexer.request("POST", "/internal/scan", { body: { libraryId: id.toLowerCase(), force: request?.force === true } });
		this.live.invalidate("indexer", "overview");
		return result;
	}

	@Post("/refresh")
	async refresh(@BodyParams() request: RefreshItemRequest, @HeaderParams("authorization") authorization?: string) {
		await this.authService.requireAdmin(authorization);
		if (!AuthService.isUuid(request.libraryId) || !(MEDIA_ITEM_TYPES as readonly string[]).includes(request.itemType)) {
			throw new BadRequest("A library id, path and item type are required.");
		}
		return this.indexer.request("POST", "/internal/refresh", { body: { ...request, libraryId: request.libraryId.toLowerCase() } });
	}

	@Get("/tasks")
	async tasks(
		@QueryParams("queue", String) queue: string,
		@QueryParams("state", String) state?: string,
		@QueryParams("page", Number) page?: number,
		@QueryParams("size", Number) size?: number,
		@HeaderParams("authorization") authorization?: string,
	) {
		await this.authService.requireAdmin(authorization);
		this.requireQueue(queue);
		if (state !== undefined && !TASK_STATES.includes(state)) {
			throw new BadRequest(`state must be one of ${TASK_STATES.join(", ")}.`);
		}
		return this.indexer.request("GET", "/internal/tasks", { query: { queue, state, page, size } });
	}

	@Post("/tasks/:queue/:id/cancel")
	async cancelTask(
		@PathParams("queue") queue: string,
		@PathParams("id") id: string,
		@HeaderParams("authorization") authorization?: string,
	) {
		await this.authService.requireAdmin(authorization);
		const result = await this.indexer.request("POST", `/internal/tasks/${this.requireQueue(queue)}/${this.requireTaskId(id)}/cancel`);
		this.live.invalidate("indexer");
		return result;
	}

	@Post("/tasks/:queue/:id/retry")
	async retryTask(
		@PathParams("queue") queue: string,
		@PathParams("id") id: string,
		@HeaderParams("authorization") authorization?: string,
	) {
		await this.authService.requireAdmin(authorization);
		const result = await this.indexer.request("POST", `/internal/tasks/${this.requireQueue(queue)}/${this.requireTaskId(id)}/retry`);
		this.live.invalidate("indexer");
		return result;
	}

	@Post("/queues/:queue/pause")
	async pause(@PathParams("queue") queue: string, @HeaderParams("authorization") authorization?: string) {
		await this.authService.requireAdmin(authorization);
		const result = await this.indexer.request("POST", `/internal/queues/${this.requireQueue(queue)}/pause`);
		this.live.invalidate("indexer");
		return result;
	}

	@Post("/queues/:queue/resume")
	async resume(@PathParams("queue") queue: string, @HeaderParams("authorization") authorization?: string) {
		await this.authService.requireAdmin(authorization);
		const result = await this.indexer.request("POST", `/internal/queues/${this.requireQueue(queue)}/resume`);
		this.live.invalidate("indexer");
		return result;
	}

	/** Sets worker counts per queue, e.g. `{ "identify": 8 }`. Saved in flixer so they survive restarts. */
	@Put("/concurrency")
	async setConcurrency(@BodyParams() request: Record<string, unknown>, @HeaderParams("authorization") authorization?: string) {
		await this.authService.requireAdmin(authorization);
		const status = await this.admin.setConcurrency(request);
		this.live.invalidate("indexer");
		return status;
	}

	private requireQueue(queue: string): string {
		if (!INDEXER_QUEUES.includes(queue)) {
			throw new NotFound("Unknown queue.");
		}
		return queue;
	}

	private requireTaskId(id: string): string {
		if (!TASK_ID_PATTERN.test(id)) {
			throw new NotFound("Task not found.");
		}
		return id;
	}
}
