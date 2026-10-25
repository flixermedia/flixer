import { Controller } from "@tsed/di";
import { NotFound } from "@tsed/exceptions";
import { BodyParams, HeaderParams, PathParams, QueryParams } from "@tsed/platform-params";
import { Delete, Get, Patch, Post, Returns, Security } from "@tsed/schema";
import { AuthService } from "../auth/authService.js";
import { IndexerClient } from "../indexer/indexerClient.js";
import { MediaLibrariesService } from "./mediaLibrariesService.js";
import { CreateMediaLibraryRequest, UpdateMediaLibraryRequest } from "./mediaLibraryRequests.js";
import { MediaRootsService } from "./mediaRootsService.js";

/** Media library management for the admin dashboard. */
@Controller("/admin/media-libraries")
@Security("BearerAuth")
export class MediaLibrariesController {

	constructor(
		private readonly authService: AuthService,
		private readonly libraries: MediaLibrariesService,
		private readonly roots: MediaRootsService,
		private readonly indexer: IndexerClient,
	) {}

	@Get("/")
	async list(@HeaderParams("authorization") authorization?: string) {
		await this.authService.requireAdmin(authorization);
		return this.libraries.list();
	}

	/** The root media folders admins can pick library folders from. */
	@Get("/roots")
	async listRoots(@HeaderParams("authorization") authorization?: string) {
		await this.authService.requireAdmin(authorization);
		return this.roots.list().map(({ id, name, path }) => ({ id, name, path }));
	}

	/** Lists the sub-folders of a folder inside a root. */
	@Get("/browse")
	async browse(
		@QueryParams("rootId", String) rootId: string,
		@QueryParams("path", String) path?: string,
		@HeaderParams("authorization") authorization?: string,
	) {
		await this.authService.requireAdmin(authorization);
		return this.roots.browse(rootId, path ?? "");
	}

	@Post("/")
	async create(@BodyParams() request: CreateMediaLibraryRequest, @HeaderParams("authorization") authorization?: string) {
		await this.authService.requireAdmin(authorization);
		return this.libraries.create(request);
	}

	@Patch("/:id")
	async update(@PathParams("id") id: string, @BodyParams() request: UpdateMediaLibraryRequest, @HeaderParams("authorization") authorization?: string) {
		await this.authService.requireAdmin(authorization);
		if (!AuthService.isUuid(id)) {
			throw new NotFound("Media library not found.");
		}
		return this.libraries.update(id.toLowerCase(), request);
	}

	@Delete("/:id")
	@Returns(204)
	async remove(@PathParams("id") id: string, @HeaderParams("authorization") authorization?: string) {
		await this.authService.requireAdmin(authorization);
		if (!AuthService.isUuid(id) || !(await this.libraries.remove(id.toLowerCase()))) {
			throw new NotFound("Media library not found.");
		}
		// Best effort: the library is already gone, so an unreachable indexer must not fail the request.
		await this.indexer.request("POST", `/internal/libraries/${id.toLowerCase()}/cancel-tasks`).catch(() => undefined);
	}
}
