import { Controller } from "@tsed/di";
import { BadRequest } from "@tsed/exceptions";
import { BodyParams, HeaderParams, PathParams } from "@tsed/platform-params";
import { Get, Post, Put, Security } from "@tsed/schema";
import { AuthService } from "../auth/authService.js";
import { UnlockRequest } from "./accessRequests.js";
import { MediaAccessService, type AccessPolicyInput } from "./mediaAccessService.js";

/** What the signed-in user is allowed to watch, and the PIN that lifts those limits on a device. */
@Controller("/access")
@Security("BearerAuth")
export class AccessController {

	constructor(private readonly access: MediaAccessService) {}

	@Get("/me")
	async me(@HeaderParams("authorization") authorization?: string) {
		return this.access.describeSelf(await this.access.resolve(authorization));
	}

	@Post("/unlock")
	async unlock(@BodyParams() request: UnlockRequest, @HeaderParams("authorization") authorization?: string) {
		const policy = await this.access.resolve(authorization);
		await this.access.unlock(policy, request.pin);
		return this.access.describeSelf(await this.access.resolve(authorization));
	}

	@Post("/lock")
	async lock(@HeaderParams("authorization") authorization?: string) {
		await this.access.relock(await this.access.resolve(authorization));
		return this.access.describeSelf(await this.access.resolve(authorization));
	}
}

/** Viewing limits for each user, managed by administrators. */
@Controller("/admin/access")
@Security("BearerAuth")
export class AdminAccessController {

	constructor(
		private readonly authService: AuthService,
		private readonly access: MediaAccessService,
	) {}

	@Get("/options")
	async options(@HeaderParams("authorization") authorization?: string) {
		await this.authService.requireAdminSession(authorization);
		return { ratings: this.access.ratingLimits(), tags: await this.access.knownTags() };
	}

	@Get("/users/:id")
	async get(@PathParams("id") id: string, @HeaderParams("authorization") authorization?: string) {
		await this.authService.requireAdminSession(authorization);
		return this.access.getPolicy(this.uuid(id));
	}

	@Put("/users/:id")
	async save(@PathParams("id") id: string, @BodyParams() request: AccessPolicyInput, @HeaderParams("authorization") authorization?: string) {
		await this.authService.requireAdminSession(authorization);
		return this.access.savePolicy(this.uuid(id), request);
	}

	/** What the user would see under the given unsaved policy, or under the saved one when none is given. */
	@Post("/users/:id/preview")
	async preview(@PathParams("id") id: string, @BodyParams() draft: AccessPolicyInput, @HeaderParams("authorization") authorization?: string) {
		await this.authService.requireAdminSession(authorization);
		return this.access.preview(this.uuid(id), Object.keys(draft ?? {}).length > 0 ? draft : undefined);
	}

	private uuid(id: string): string {
		if (!AuthService.isUuid(id)) throw new BadRequest("Invalid user id.");
		return id.toLowerCase();
	}
}
