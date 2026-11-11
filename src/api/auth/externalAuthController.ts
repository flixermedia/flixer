import { Controller } from "@tsed/di";
import { TooManyRequests } from "@tsed/exceptions";
import type { PlatformContext } from "@tsed/platform-http";
import { BodyParams, Context, HeaderParams, PathParams } from "@tsed/platform-params";
import { Get, MaxLength, Post, Property, Required, Security } from "@tsed/schema";
import { ExternalAuthService } from "./externalAuthService.js";
import { ExternalOAuthService } from "./externalOAuthService.js";

class ExternalCredentials {
	@Property() @Required() @MaxLength(254) username!: string;
	@Property() @Required() @MaxLength(1024) password!: string;
}

class LinkExternalCredentials extends ExternalCredentials {
	@Property() @Required() @MaxLength(128) accountPassword!: string;
}

class UnlinkExternalCredentials {
	@Property() @Required() @MaxLength(128) accountPassword!: string;
}

class OAuthStartRequest {
	@Property() @Required() @MaxLength(43) browserSecret!: string;
	@Property() @Required() link!: boolean;
	@Property() @MaxLength(128) accountPassword?: string;
}

class OAuthFinishRequest {
	@Property() @Required() @MaxLength(43) state!: string;
	@Property() @Required() @MaxLength(43) browserSecret!: string;
	@Property() @Required() @MaxLength(4096) code!: string;
}

@Controller("/auth/providers")
export class ExternalAuthController {
	constructor(private readonly service: ExternalAuthService, private readonly oauth: ExternalOAuthService) {}
	private readonly attempts = new Map<string, { count: number; until: number }>();

	@Get("/")
	providers() { return this.service.providers(); }

	@Get("/linked")
	@Security("BearerAuth")
	linked(@HeaderParams("authorization") authorization?: string) { return this.service.linked(authorization); }

	@Post("/:pluginId/oauth/start")
	startOAuth(@PathParams("pluginId") pluginId: string, @BodyParams() request: OAuthStartRequest, @Context() context: PlatformContext, @HeaderParams("authorization") authorization?: string) {
		this.throttle(context);
		return this.oauth.start(pluginId, request.browserSecret, request.link, request.accountPassword, authorization);
	}

	@Post("/:pluginId/oauth/finish")
	finishOAuth(@PathParams("pluginId") pluginId: string, @BodyParams() request: OAuthFinishRequest, @Context() context: PlatformContext, @HeaderParams("authorization") authorization?: string) {
		this.throttle(context);
		return this.oauth.finish(pluginId, request.state, request.browserSecret, request.code, authorization);
	}

	@Post("/:pluginId/directory/link")
	@Security("BearerAuth")
	link(@PathParams("pluginId") pluginId: string, @BodyParams() request: LinkExternalCredentials, @Context() context: PlatformContext, @HeaderParams("authorization") authorization?: string) {
		this.throttle(context);
		return this.service.link(pluginId, request.username, request.password, request.accountPassword, authorization);
	}

	@Post("/:pluginId/directory/login")
	login(@PathParams("pluginId") pluginId: string, @BodyParams() request: ExternalCredentials, @Context() context: PlatformContext) {
		this.throttle(context);
		return this.service.login(pluginId, request.username, request.password);
	}

	@Post("/:pluginId/unlink")
	@Security("BearerAuth")
	unlink(@PathParams("pluginId") pluginId: string, @BodyParams() request: UnlinkExternalCredentials, @Context() context: PlatformContext, @HeaderParams("authorization") authorization?: string) {
		this.throttle(context);
		return this.service.unlink(pluginId, request.accountPassword, authorization);
	}

	private throttle(context: PlatformContext) {
		const now = Date.now();
		if (this.attempts.size > 10_000) for (const [key, value] of this.attempts) if (value.until <= now) this.attempts.delete(key);
		const address = context.request.raw?.ip || "unknown";
		const attempt = this.attempts.get(address);
		if (!attempt && this.attempts.size >= 10_000) throw new TooManyRequests("Too many sign-in attempts. Try again later.");
		if (!attempt || attempt.until <= now) this.attempts.set(address, { count: 1, until: now + 60_000 });
		else if (++attempt.count > 10) throw new TooManyRequests("Too many sign-in attempts. Try again later.");
	}
}