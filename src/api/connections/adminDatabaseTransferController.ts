import { Controller } from "@tsed/di";
import { BadRequest } from "@tsed/exceptions";
import { BodyParams, HeaderParams } from "@tsed/platform-params";
import { Get, Post, Security } from "@tsed/schema";
import { AuthService } from "../auth/authService.js";
import { DatabaseTransferService } from "./databaseTransferService.js";

/** Performs a full PostgreSQL transfer from the admin connections page. */
@Controller("/admin/database-transfer")
@Security("BearerAuth")
export class AdminDatabaseTransferController {
	constructor(
		private readonly authService: AuthService,
		private readonly transfer: DatabaseTransferService,
	) {}

	@Get("/")
	async status(@HeaderParams("authorization") authorization?: string) {
		await this.authService.requireAdmin(authorization);
		return this.transfer.status();
	}

	@Post("/")
	async start(@BodyParams() body: unknown, @HeaderParams("authorization") authorization?: string) {
		await this.authService.requireAdminSession(authorization);
		const payload = body as { databaseUrl?: unknown; replaceTarget?: unknown } | null;
		const targetUrl = payload?.databaseUrl;
		if (typeof targetUrl !== "string") {
			throw new BadRequest("A target database URL is required.");
		}
		if (payload?.replaceTarget !== undefined && typeof payload.replaceTarget !== "boolean") {
			throw new BadRequest("replaceTarget must be a boolean.");
		}
		return this.transfer.start(targetUrl, payload?.replaceTarget === true);
	}

	@Post("/restore-writes")
	async restoreWrites(@HeaderParams("authorization") authorization?: string) {
		await this.authService.requireAdminSession(authorization);
		return this.transfer.restoreSourceWrites();
	}
}
