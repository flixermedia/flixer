import { Controller } from "@tsed/di";
import { BadRequest } from "@tsed/exceptions";
import { MulterOptions, MultipartFile, type PlatformMulterFile } from "@tsed/platform-multer";
import { BodyParams, Context, HeaderParams, PathParams, QueryParams } from "@tsed/platform-params";
import type { PlatformContext } from "@tsed/platform-http";
import { Delete, Get, Post, Put, Returns, Security } from "@tsed/schema";
import { rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { AuthService } from "../auth/authService.js";
import { BackupService } from "./backupService.js";

const uploadDirectory = () => join(resolve(process.env.BACKUP_DIR?.trim() || "./data/backups"), ".uploads");

/** Full-system backups: create, list, download, upload, delete and the encryption passphrase handled here; restore is delegated to the updater. Administrators only. */
@Controller("/admin/backups")
@Security("BearerAuth")
export class AdminBackupsController {

	constructor(
		private readonly authService: AuthService,
		private readonly backups: BackupService,
	) {}

	@Get("/")
	async status(@HeaderParams("authorization") authorization?: string) {
		await this.authService.requireAdmin(authorization);
		return this.backups.status();
	}

	@Post("/")
	@Returns(202)
	async create(@HeaderParams("authorization") authorization?: string) {
		await this.authService.requireAdminSession(authorization);
		return this.backups.create();
	}

	@Post("/upload")
	@MulterOptions({ dest: uploadDirectory(), limits: { files: 1 } })
	async upload(@MultipartFile("backup") file: PlatformMulterFile | undefined, @HeaderParams("authorization") authorization?: string) {
		await this.authService.requireAdminSession(authorization);
		if (!file?.path) {
			throw new BadRequest("Choose a backup file to upload.");
		}
		try {
			return await this.backups.upload(file.path);
		} finally {
			await rm(file.path, { force: true });
		}
	}

	@Put("/passphrase")
	async setPassphrase(@BodyParams() body: { passphrase?: unknown } | undefined, @HeaderParams("authorization") authorization?: string) {
		await this.authService.requireAdminSession(authorization);
		await this.backups.setPassphrase(body?.passphrase);
		return { passphraseSet: true };
	}

	@Delete("/passphrase")
	async clearPassphrase(@HeaderParams("authorization") authorization?: string) {
		await this.authService.requireAdminSession(authorization);
		await this.backups.clearPassphrase();
		return { passphraseSet: false };
	}

	@Post("/:name/restore")
	async restore(@PathParams("name") name: string, @BodyParams() body: { passphrase?: unknown } | undefined, @HeaderParams("authorization") authorization?: string) {
		await this.authService.requireAdminSession(authorization);
		const passphrase = typeof body?.passphrase === "string" && body.passphrase !== "" ? body.passphrase : undefined;
		return this.backups.restore(name, passphrase);
	}

	@Post("/:name/download-link")
	async downloadLink(@PathParams("name") name: string, @HeaderParams("authorization") authorization?: string) {
		await this.authService.requireAdminSession(authorization);
		return this.backups.downloadLink(name);
	}

	@Delete("/:name")
	async remove(@PathParams("name") name: string, @HeaderParams("authorization") authorization?: string) {
		await this.authService.requireAdminSession(authorization);
		await this.backups.remove(name);
		return { deleted: name };
	}
}

/** The download itself is authorised by a short-lived signed link, so a browser can save multi-gigabyte files without holding them in memory. */
@Controller("/backups")
export class BackupDownloadController {

	constructor(private readonly backups: BackupService) {}

	@Get("/download/:name")
	async download(
		@PathParams("name") name: string,
		@QueryParams("expires", String) expires: string | undefined,
		@QueryParams("signature", String) signature: string | undefined,
		@Context() ctx: PlatformContext,
	) {
		const { stream, size } = await this.backups.openDownload(name, expires, signature);
		ctx.response.setHeader("Content-Type", "application/octet-stream");
		ctx.response.setHeader("Content-Length", String(size));
		ctx.response.setHeader("Content-Disposition", `attachment; filename="${name}"`);
		ctx.response.setHeader("Cache-Control", "no-store");
		ctx.response.setHeader("X-Content-Type-Options", "nosniff");
		return stream;
	}
}
