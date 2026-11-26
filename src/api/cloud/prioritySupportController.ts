import { Controller } from "@tsed/di";
import { BodyParams, Context, HeaderParams, QueryParams } from "@tsed/platform-params";
import { Get, Post, Security } from "@tsed/schema";
import type { PlatformContext } from "@tsed/platform-http";
import { AuthService } from "../auth/authService.js";
import { PrioritySupportGateway } from "./prioritySupportGateway.js";
import { PrioritySupportService, type SupportChatAttachmentInput } from "./prioritySupportService.js";

/** Priority Support chat and diagnostics proxy for servers with an active priority_support Cloud feature. Administrators only. */
@Controller("/admin/cloud/support")
@Security("BearerAuth")
export class PrioritySupportController {

	constructor(
		private readonly authService: AuthService,
		private readonly prioritySupport: PrioritySupportService,
		private readonly gateway: PrioritySupportGateway,
	) {}

	@Get("/diagnostics")
	async diagnostics(@HeaderParams("authorization") authorization?: string) {
		await this.authService.requireAdmin(authorization);
		return this.prioritySupport.getDiagnostics();
	}

	@Get("/messages")
	async messages(@HeaderParams("authorization") authorization?: string) {
		await this.authService.requireAdmin(authorization);
		return this.prioritySupport.getMessages();
	}

	@Get("/attachment")
	async attachment(
		@QueryParams("path") path: string,
		@HeaderParams("authorization") authorization: string | undefined,
		@Context() ctx: PlatformContext,
	) {
		await this.authService.requireAdmin(authorization);
		const { buffer, contentType } = await this.prioritySupport.getAttachment(path ?? "");
		ctx.response.setHeader("content-type", contentType);
		ctx.response.setHeader("cache-control", "private, max-age=300");
		return buffer;
	}

	@Post("/messages")
	async sendMessage(
		@BodyParams("message") message?: string,
		@BodyParams("attachment") attachment?: SupportChatAttachmentInput,
		@HeaderParams("authorization") authorization?: string,
	) {
		await this.authService.requireAdminSession(authorization);
		const result = await this.prioritySupport.sendMessage(
			message ?? "",
			attachment?.dataUrl ? { dataUrl: attachment.dataUrl, name: attachment.name } : undefined,
		);
		this.gateway.broadcastMessage(result.room, result.message, result.realtime);
		return result;
	}

	@Post("/close")
	async closeSession(@HeaderParams("authorization") authorization?: string) {
		await this.authService.requireAdminSession(authorization);
		const result = await this.prioritySupport.closeSession();
		this.gateway.broadcastClosed("user");
		return result;
	}
}
