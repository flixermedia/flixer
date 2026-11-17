import { Controller } from "@tsed/di";
import { BadRequest, NotFound } from "@tsed/exceptions";
import { BodyParams, HeaderParams, PathParams, QueryParams } from "@tsed/platform-params";
import { Delete, Get, Post, Put, Returns, Security } from "@tsed/schema";
import { AuthService } from "../auth/authService.ts";
import { MediaOrganizationService } from "./mediaOrganizationService.ts";

interface TemplatesRequest {
	templates: unknown;
}

interface PasswordRequest {
	password?: unknown;
}

interface WritePermissionsRequest {
	organizationWritesEnabled?: unknown;
	nfoWritesEnabled?: unknown;
}

/** Admin-only organization planning and per-library media-write permissions. */
@Controller("/admin/media-libraries")
@Security("BearerAuth")
export class MediaOrganizationController {
	constructor(
		private readonly auth: AuthService,
		private readonly organization: MediaOrganizationService,
	) {}

	@Get("/:libraryId/organization")
	async settings(@PathParams("libraryId") libraryId: string, @HeaderParams("authorization") authorization?: string) {
		await this.auth.requireAdmin(authorization);
		return this.organization.settings(this.libraryId(libraryId));
	}

	@Put("/:libraryId/organization/templates")
	async saveTemplates(@PathParams("libraryId") libraryId: string, @BodyParams() request: TemplatesRequest, @HeaderParams("authorization") authorization?: string) {
		const { user } = await this.auth.requireAdminSession(authorization);
		return this.organization.saveTemplates(this.libraryId(libraryId), request?.templates, user.id);
	}

	@Put("/:libraryId/organization/write-permissions")
	async writePermissions(@PathParams("libraryId") libraryId: string, @BodyParams() request: WritePermissionsRequest, @HeaderParams("authorization") authorization?: string) {
		await this.auth.requireAdminSession(authorization);
		return this.organization.setWritePermissions(this.libraryId(libraryId), {
			organizationWritesEnabled: request?.organizationWritesEnabled,
			nfoWritesEnabled: request?.nfoWritesEnabled,
		});
	}

	@Get("/:libraryId/organization/plans")
	async list(@PathParams("libraryId") libraryId: string, @HeaderParams("authorization") authorization?: string) {
		await this.auth.requireAdmin(authorization);
		return this.organization.list(this.libraryId(libraryId));
	}

	@Post("/:libraryId/organization/plans")
	async create(@PathParams("libraryId") libraryId: string, @HeaderParams("authorization") authorization?: string) {
		const { user } = await this.auth.requireAdminSession(authorization);
		return this.organization.createPlan(this.libraryId(libraryId), user.id);
	}

	@Get("/:libraryId/organization/plans/:planId")
	async get(@PathParams("libraryId") libraryId: string, @PathParams("planId") planId: string, @HeaderParams("authorization") authorization?: string) {
		await this.auth.requireAdmin(authorization);
		return this.organization.get(this.libraryId(libraryId), this.planId(planId));
	}

	@Get("/:libraryId/organization/plans/:planId/reconcile")
	async reconcile(
		@PathParams("libraryId") libraryId: string,
		@PathParams("planId") planId: string,
		@QueryParams("offset", Number) offset?: number,
		@QueryParams("limit", Number) limit?: number,
		@HeaderParams("authorization") authorization?: string,
	) {
		await this.auth.requireAdmin(authorization);
		return this.organization.reconcilePlan(this.libraryId(libraryId), this.planId(planId), offset, limit);
	}

	@Post("/:libraryId/organization/plans/:planId/recover")
	async recover(@PathParams("libraryId") libraryId: string, @PathParams("planId") planId: string, @BodyParams() request: PasswordRequest, @HeaderParams("authorization") authorization?: string) {
		const { user } = await this.auth.requireAdminSession(authorization);
		if (typeof request?.password !== "string" || request.password.length === 0 || request.password.length > 128) throw new BadRequest("An admin password is required.");
		await this.auth.assertPassword(authorization, request.password);
		return this.organization.recoverUnmovedPlan(this.libraryId(libraryId), this.planId(planId), user.id);
	}

	@Post("/:libraryId/organization/plans/:planId/execute")
	async execute(@PathParams("libraryId") libraryId: string, @PathParams("planId") planId: string, @BodyParams() request: PasswordRequest, @HeaderParams("authorization") authorization?: string) {
		const { user } = await this.auth.requireAdminSession(authorization);
		if (typeof request?.password !== "string" || request.password.length === 0 || request.password.length > 128) throw new BadRequest("An admin password is required.");
		await this.auth.assertPassword(authorization, request.password);
		return this.organization.execute(this.libraryId(libraryId), this.planId(planId), user.id);
	}

	@Post("/:libraryId/organization/plans/:planId/rollback")
	async rollback(@PathParams("libraryId") libraryId: string, @PathParams("planId") planId: string, @BodyParams() request: PasswordRequest, @HeaderParams("authorization") authorization?: string) {
		const { user } = await this.auth.requireAdminSession(authorization);
		if (typeof request?.password !== "string" || request.password.length === 0 || request.password.length > 128) throw new BadRequest("An admin password is required.");
		await this.auth.assertPassword(authorization, request.password);
		return this.organization.rollback(this.libraryId(libraryId), this.planId(planId), user.id);
	}

	@Delete("/:libraryId/organization/plans/:planId")
	@Returns(204)
	async remove(@PathParams("libraryId") libraryId: string, @PathParams("planId") planId: string, @HeaderParams("authorization") authorization?: string) {
		const { user } = await this.auth.requireAdminSession(authorization);
		await this.organization.remove(this.libraryId(libraryId), this.planId(planId), user.id);
	}

	private libraryId(value: string): string {
		if (!AuthService.isUuid(value)) throw new NotFound("Media library not found.");
		return value.toLowerCase();
	}

	private planId(value: string): string {
		if (!AuthService.isUuid(value)) throw new NotFound("Organization plan not found.");
		return value.toLowerCase();
	}
}
