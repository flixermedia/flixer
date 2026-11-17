import { Controller } from "@tsed/di";
import { MulterOptions, MultipartFile, type PlatformMulterFile } from "@tsed/platform-multer";
import { Context, HeaderParams, PathParams } from "@tsed/platform-params";
import type { PlatformContext } from "@tsed/platform-http";
import { Delete, Get, Post, Security } from "@tsed/schema";
import { AvatarService } from "./avatarService.js";
import { MAX_AVATAR_BYTES } from "./avatarStorage.js";

@Controller("/auth")
export class AvatarController {

	constructor(private readonly avatarService: AvatarService) {}

	@Post("/me/avatar")
	@Security("BearerAuth")
	@MulterOptions({ limits: { fileSize: MAX_AVATAR_BYTES, files: 1 } })
	upload(@MultipartFile("avatar") file: PlatformMulterFile, @HeaderParams("authorization") authorization?: string) {
		return this.avatarService.uploadAvatar(authorization, file);
	}

	@Delete("/me/avatar")
	@Security("BearerAuth")
	remove(@HeaderParams("authorization") authorization?: string) {
		return this.avatarService.removeAvatar(authorization);
	}

	/** Public so it can be used as an <img> source; filenames contain a random token and are never guessable from a user id alone. */
	@Get("/avatars/:filename")
	async avatar(@PathParams("filename") filename: string, @Context() ctx: PlatformContext) {
		const { data, mime } = await this.avatarService.getAvatar(filename);
		ctx.response.setHeader("Content-Type", mime);
		ctx.response.setHeader("Cache-Control", "public, max-age=31536000, immutable");
		ctx.response.setHeader("X-Content-Type-Options", "nosniff");
		ctx.response.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
		return data;
	}
}
