import { Controller } from "@tsed/di";
import { NotFound } from "@tsed/exceptions";
import type { PlatformContext } from "@tsed/platform-http";
import { MulterOptions, MultipartFile, type PlatformMulterFile } from "@tsed/platform-multer";
import { BodyParams, Context, HeaderParams, PathParams, QueryParams } from "@tsed/platform-params";
import { Delete, Get, Patch, Post, Put, Returns, Security } from "@tsed/schema";
import { AuthService } from "../auth/authService.js";
import {
	RefreshMediaItemRequest,
	SetSegmentRequest,
	SubtitleDownloadRequest,
	SubtitleSearchRequest,
	UpdateMediaItemRequest,
} from "./adminMediaRequests.js";
import { AdminMediaService } from "./adminMediaService.js";
import { MediaSegmentsService } from "./mediaSegmentsService.js";
import { SubtitleService } from "./subtitleService.js";
import { MAX_MEDIA_IMAGE_BYTES } from "./mediaImageStorage.js";

/** View and edit everything flixer-indexer has saved, for the admin dashboard. */
@Controller("/admin/media")
@Security("BearerAuth")
export class AdminMediaController {

	constructor(
		private readonly authService: AuthService,
		private readonly media: AdminMediaService,
		private readonly subtitles: SubtitleService,
		private readonly segments: MediaSegmentsService,
	) {}

	@Get("/items/:id/subtitles")
	async listSubtitles(@PathParams("id") id: string, @HeaderParams("authorization") authorization?: string) {
		await this.authService.requireAdmin(authorization);
		return this.subtitles.list(this.requireId(id));
	}

	@Post("/items/:id/subtitles/search")
	async searchSubtitles(
		@PathParams("id") id: string,
		@BodyParams() request: SubtitleSearchRequest,
		@HeaderParams("authorization") authorization?: string,
	) {
		await this.authService.requireAdmin(authorization);
		return this.subtitles.search(this.requireId(id), { query: request.query, languages: request.languages });
	}

	@Post("/items/:id/subtitles/download")
	async downloadSubtitle(
		@PathParams("id") id: string,
		@BodyParams() request: SubtitleDownloadRequest,
		@HeaderParams("authorization") authorization?: string,
	) {
		await this.authService.requireAdmin(authorization);
		return this.subtitles.download(this.requireId(id), request.fileId, request.language);
	}

	@Delete("/items/:id/subtitles")
	@Returns(204)
	async removeSubtitle(
		@PathParams("id") id: string,
		@QueryParams("file", String) file: string,
		@HeaderParams("authorization") authorization?: string,
	) {
		await this.authService.requireAdmin(authorization);
		await this.subtitles.remove(this.requireId(id), file ?? "");
	}

	@Put("/items/:id/segments/:type")
	@Returns(204)
	async setSegment(
		@PathParams("id") id: string,
		@PathParams("type") type: string,
		@BodyParams() request: SetSegmentRequest,
		@HeaderParams("authorization") authorization?: string,
	) {
		await this.authService.requireAdmin(authorization);
		await this.segments.setManual(this.requireId(id), type, request.startMs, request.endMs);
	}

	@Delete("/items/:id/segments/:type")
	@Returns(204)
	async clearSegment(
		@PathParams("id") id: string,
		@PathParams("type") type: string,
		@HeaderParams("authorization") authorization?: string,
	) {
		await this.authService.requireAdmin(authorization);
		await this.segments.clearManual(this.requireId(id), type);
	}

	@Get("/items")
	async list(
		@QueryParams("libraryId", String) libraryId?: string,
		@QueryParams("type", String) type?: string,
		@QueryParams("parentId", String) parentId?: string,
		@QueryParams("search", String) search?: string,
		@QueryParams("page", Number) page?: number,
		@QueryParams("size", Number) size?: number,
		@HeaderParams("authorization") authorization?: string,
	) {
		await this.authService.requireAdmin(authorization);
		if ((libraryId && !AuthService.isUuid(libraryId)) || (parentId && !AuthService.isUuid(parentId))) {
			throw new NotFound("Media library or item not found.");
		}
		return this.media.list({
			libraryId: libraryId?.toLowerCase(),
			type,
			parentId: parentId?.toLowerCase(),
			search,
			page,
			size,
		});
	}

	@Get("/items/:id")
	async get(@PathParams("id") id: string, @HeaderParams("authorization") authorization?: string) {
		await this.authService.requireAdmin(authorization);
		return this.media.get(this.requireId(id));
	}

	@Patch("/items/:id")
	async update(
		@PathParams("id") id: string,
		@BodyParams() request: UpdateMediaItemRequest,
		@HeaderParams("authorization") authorization?: string,
	) {
		await this.authService.requireAdmin(authorization);
		return this.media.update(this.requireId(id), request);
	}

	/** Rescans one item. A series, season or album also rescans everything beneath it. */
	@Post("/items/:id/refresh")
	async refresh(
		@PathParams("id") id: string,
		@BodyParams() request: RefreshMediaItemRequest,
		@HeaderParams("authorization") authorization?: string,
	) {
		await this.authService.requireAdmin(authorization);
		return this.media.refresh(this.requireId(id), request?.priority === true);
	}

	@Delete("/items/:id")
	@Returns(204)
	async remove(@PathParams("id") id: string, @HeaderParams("authorization") authorization?: string) {
		await this.authService.requireAdmin(authorization);
		await this.media.remove(this.requireId(id));
	}

	/** An image's bytes. Authenticated, so the admin UI fetches it with its token rather than using a plain img src. */
	@Get("/items/:id/images/:index")
	async image(
		@PathParams("id") id: string,
		@PathParams("index", Number) index: number,
		@QueryParams("w", Number) width: number | undefined,
		@Context() ctx: PlatformContext,
		@HeaderParams("authorization") authorization?: string,
	) {
		await this.authService.requireAdmin(authorization);
		if (!Number.isInteger(index) || index < 0) {
			throw new NotFound("Image not found.");
		}
		const { data, mime } = await this.media.image(this.requireId(id), index, width);
		ctx.response.setHeader("Content-Type", mime);
		ctx.response.setHeader("Cache-Control", "private, no-store");
		ctx.response.setHeader("X-Content-Type-Options", "nosniff");
		ctx.response.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
		return data;
	}

	@Post("/items/:id/images")
	@MulterOptions({ limits: { fileSize: MAX_MEDIA_IMAGE_BYTES, files: 1 } })
	async addImage(
		@PathParams("id") id: string,
		@QueryParams("type", String) type: string,
		@MultipartFile("image") file: PlatformMulterFile,
		@HeaderParams("authorization") authorization?: string,
	) {
		await this.authService.requireAdmin(authorization);
		return this.media.addImage(this.requireId(id), type, file?.buffer);
	}

	@Delete("/items/:id/images/:index")
	async removeImage(
		@PathParams("id") id: string,
		@PathParams("index", Number) index: number,
		@HeaderParams("authorization") authorization?: string,
	) {
		await this.authService.requireAdmin(authorization);
		if (!Number.isInteger(index) || index < 0) {
			throw new NotFound("Image not found.");
		}
		return this.media.removeImage(this.requireId(id), index);
	}

	private requireId(id: string): string {
		if (!AuthService.isUuid(id)) {
			throw new NotFound("Media item not found.");
		}
		return id.toLowerCase();
	}
}
