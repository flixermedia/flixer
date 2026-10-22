import { Controller } from "@tsed/di";
import { NotFound } from "@tsed/exceptions";
import { BodyParams, HeaderParams, PathParams } from "@tsed/platform-params";
import { Delete, Get, Post, Returns, Security } from "@tsed/schema";
import { AuthService } from "../auth/authService.js";
import { ApiKeyService } from "./apiKeyService.js";
import { CreateApiKeyRequest } from "./createApiKeyRequest.js";

/** Admin management of API keys. Needs a signed-in administrator; a key can't create or list keys. */
@Controller("/admin/api-keys")
@Security("BearerAuth")
export class ApiKeysController {

	constructor(
		private readonly authService: AuthService,
		private readonly apiKeys: ApiKeyService,
	) {}

	@Get("/")
	async list(@HeaderParams("authorization") authorization?: string) {
		await this.authService.requireAdminSession(authorization);
		return this.apiKeys.list();
	}

	@Post("/")
	async create(@BodyParams() request: CreateApiKeyRequest, @HeaderParams("authorization") authorization?: string) {
		const { user } = await this.authService.requireAdminSession(authorization);
		return this.apiKeys.create(user, request.name);
	}

	@Delete("/:id")
	@Returns(204)
	async revoke(@PathParams("id") id: string, @HeaderParams("authorization") authorization?: string) {
		await this.authService.requireAdminSession(authorization);
		if (!AuthService.isUuid(id) || !(await this.apiKeys.revoke(id.toLowerCase()))) {
			throw new NotFound("API key not found.");
		}
	}
}
