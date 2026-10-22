import { Controller } from "@tsed/di";
import { MulterOptions, MultipartFile, type PlatformMulterFile } from "@tsed/platform-multer";
import { BodyParams, HeaderParams, PathParams } from "@tsed/platform-params";
import { Delete, Get, Patch, Post, Put, Returns, Security } from "@tsed/schema";
import { AuthService } from "../auth/authService.js";
import { MAX_AVATAR_BYTES } from "../auth/avatarStorage.js";
import { CreateAdminUserRequest, SetUserPasswordRequest, UpdateAdminUserRequest } from "./adminUserRequests.js";
import { AdminUsersService } from "./adminUsersService.js";

/** User management for the admin dashboard. Needs a signed-in administrator; API keys can't manage users. */
@Controller("/admin/users")
@Security("BearerAuth")
export class AdminUsersController {

	constructor(
		private readonly authService: AuthService,
		private readonly users: AdminUsersService,
	) {}

	@Get("/")
	async list(@HeaderParams("authorization") authorization?: string) {
		const { user } = await this.authService.requireAdminSession(authorization);
		return this.users.list(user.id);
	}

	@Post("/")
	async create(@BodyParams() request: CreateAdminUserRequest, @HeaderParams("authorization") authorization?: string) {
		const { user } = await this.authService.requireAdminSession(authorization);
		return this.users.create(request, user.id);
	}

	@Patch("/:id")
	async update(@PathParams("id") id: string, @BodyParams() request: UpdateAdminUserRequest, @HeaderParams("authorization") authorization?: string) {
		const { user } = await this.authService.requireAdminSession(authorization);
		return this.users.update(id, request, user.id);
	}

	@Post("/:id/avatar")
	@MulterOptions({ limits: { fileSize: MAX_AVATAR_BYTES, files: 1 } })
	async setAvatar(@PathParams("id") id: string, @MultipartFile("avatar") file: PlatformMulterFile, @HeaderParams("authorization") authorization?: string) {
		const { user } = await this.authService.requireAdminSession(authorization);
		return this.users.setAvatar(id, file, user.id);
	}

	@Delete("/:id/avatar")
	async removeAvatar(@PathParams("id") id: string, @HeaderParams("authorization") authorization?: string) {
		const { user } = await this.authService.requireAdminSession(authorization);
		return this.users.removeAvatar(id, user.id);
	}

	@Put("/:id/password")
	@Returns(204)
	async setPassword(@PathParams("id") id: string, @BodyParams() request: SetUserPasswordRequest, @HeaderParams("authorization") authorization?: string) {
		await this.authService.requireAdminSession(authorization);
		await this.users.setPassword(id, request.password);
	}

	@Delete("/:id/sessions")
	async revokeSessions(@PathParams("id") id: string, @HeaderParams("authorization") authorization?: string) {
		const { session } = await this.authService.requireAdminSession(authorization);
		return this.users.revokeSessions(id, session.id);
	}

	@Delete("/:id")
	@Returns(204)
	async remove(@PathParams("id") id: string, @HeaderParams("authorization") authorization?: string) {
		const { user } = await this.authService.requireAdminSession(authorization);
		await this.users.remove(id, user.id);
	}
}
