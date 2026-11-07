import { Controller } from "@tsed/di";
import { BadRequest, NotFound } from "@tsed/exceptions";
import { Middleware, UseBefore } from "@tsed/platform-middlewares";
import { MulterOptions, MultipartFile, type PlatformMulterFile } from "@tsed/platform-multer";
import { BodyParams, HeaderParams, PathParams } from "@tsed/platform-params";
import { Delete, Get, Post, Put, Returns, Security } from "@tsed/schema";
import { AuthService } from "../auth/authService.js";
import { AD_CHUNK_BYTES, AdvertisementService } from "./advertisementService.js";

@Middleware({ priority: -100 })
class RequireAdvertisementAdmin {
	constructor(private readonly auth: AuthService) {}
	async use(@HeaderParams("authorization") authorization?: string) {
		await this.auth.requireAdminSession(authorization);
	}
}

@Controller("/admin/advertisements")
@Security("BearerAuth")
@UseBefore(RequireAdvertisementAdmin)
export class AdvertisementController {
	constructor(private readonly ads: AdvertisementService, private readonly auth: AuthService) {}

	@Get("/settings")
	settings() { return this.ads.settings(); }

	@Put("/settings")
	saveSettings(@BodyParams() body: unknown) { return this.ads.saveSettings(body); }

	@Get("/")
	list() { return this.ads.list(); }

	@Post("/uploads")
	async createUpload(@BodyParams() body: { size?: number }, @HeaderParams("authorization") authorization?: string) {
		const { user } = await this.auth.requireAdminSession(authorization);
		return this.ads.createUpload(user.id, body?.size ?? 0);
	}

	@Put("/uploads/:id/chunks/:index")
	@MulterOptions({ limits: { fileSize: AD_CHUNK_BYTES, files: 1, fields: 0 } })
	async chunk(@PathParams("id") id: string, @PathParams("index", Number) index: number,
		@MultipartFile("chunk") file: PlatformMulterFile | undefined, @HeaderParams("authorization") authorization?: string) {
		const { user } = await this.auth.requireAdminSession(authorization);
		if (!file?.buffer) throw new BadRequest("Choose a chunk to upload.");
		await this.ads.putChunk(id, user.id, index, file.buffer);
		return { uploaded: true };
	}

	@Post("/uploads/:id/complete")
	async complete(@PathParams("id") id: string, @BodyParams() body: unknown, @HeaderParams("authorization") authorization?: string) {
		const { user } = await this.auth.requireAdminSession(authorization);
		return this.ads.completeUpload(id, user.id, body);
	}

	@Delete("/uploads/:id")
	@Returns(204)
	async cancel(@PathParams("id") id: string, @HeaderParams("authorization") authorization?: string) {
		const { user } = await this.auth.requireAdminSession(authorization);
		await this.ads.cancelUpload(id, user.id);
	}

	@Put("/:id")
	update(@PathParams("id") id: string, @BodyParams() body: unknown) {
		if (!AuthService.isUuid(id)) throw new NotFound("Advertisement not found.");
		return this.ads.update(id.toLowerCase(), body);
	}

	@Delete("/:id")
	@Returns(204)
	async remove(@PathParams("id") id: string) {
		if (!AuthService.isUuid(id)) throw new NotFound("Advertisement not found.");
		await this.ads.remove(id.toLowerCase());
	}
}
