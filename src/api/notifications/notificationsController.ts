import { Controller } from "@tsed/di";
import { BadRequest, NotFound } from "@tsed/exceptions";
import { BodyParams, HeaderParams, PathParams, QueryParams } from "@tsed/platform-params";
import { Delete, Get, Post, Put, Returns, Security } from "@tsed/schema";
import { AuthService } from "../auth/authService.js";
import { NotificationService } from "./notificationService.js";
import { MarkReadRequest, PushSubscriptionRequest, PushUnsubscribeRequest, SendNotificationRequest } from "./notificationRequests.js";

/** A signed-in user's own inbox and Web Push subscriptions. */
@Controller("/notifications")
@Security("BearerAuth")
export class NotificationsController {

	constructor(
		private readonly authService: AuthService,
		private readonly notifications: NotificationService,
	) {}

	@Get("/")
	async list(@HeaderParams("authorization") authorization?: string) {
		const user = await this.authService.getAuthenticatedUser(authorization);
		return this.notifications.list(user.id);
	}

	@Post("/read")
	@Returns(204)
	async markRead(@BodyParams() request: MarkReadRequest, @HeaderParams("authorization") authorization?: string) {
		const user = await this.authService.getAuthenticatedUser(authorization);
		const ids = (request.ids ?? []).filter((id) => AuthService.isUuid(id)).map((id) => id.toLowerCase());
		await this.notifications.markRead(user.id, ids);
	}

	@Delete("/:id")
	@Returns(204)
	async remove(@PathParams("id") id: string, @HeaderParams("authorization") authorization?: string) {
		const user = await this.authService.getAuthenticatedUser(authorization);
		if (!AuthService.isUuid(id)) {
			throw new NotFound("Notification not found.");
		}
		await this.notifications.remove(user.id, id.toLowerCase());
	}

	@Get("/config")
	async config(@HeaderParams("authorization") authorization?: string) {
		await this.authService.getAuthenticatedUser(authorization);
		const { enabled, permissionPrompt } = await this.notifications.getConfig();
		return { enabled, permissionPrompt };
	}

	@Get("/push/key")
	async pushKey(@HeaderParams("authorization") authorization?: string) {
		await this.authService.getAuthenticatedUser(authorization);
		return { publicKey: await this.notifications.publicKey() };
	}

	@Get("/push/status")
	async pushStatus(@QueryParams("endpoint", String) endpoint: string | undefined, @HeaderParams("authorization") authorization?: string) {
		const user = await this.authService.getAuthenticatedUser(authorization);
		return { subscribed: typeof endpoint === "string" && endpoint.length > 0 ? await this.notifications.isSubscribed(user.id, endpoint) : false };
	}

	@Put("/push/subscription")
	@Returns(204)
	async subscribe(@BodyParams() request: PushSubscriptionRequest, @HeaderParams("authorization") authorization?: string) {
		const user = await this.authService.getAuthenticatedUser(authorization);
		await this.notifications.subscribe(user.id, { endpoint: request.endpoint, p256dh: request.keys.p256dh, auth: request.keys.auth });
	}

	@Post("/push/unsubscribe")
	@Returns(204)
	async unsubscribe(@BodyParams() request: PushUnsubscribeRequest, @HeaderParams("authorization") authorization?: string) {
		const user = await this.authService.getAuthenticatedUser(authorization);
		await this.notifications.unsubscribe(user.id, request.endpoint);
	}
}

/** Custom notifications sent by an administrator to everyone or to chosen users. */
@Controller("/admin/notifications")
@Security("BearerAuth")
export class AdminNotificationsController {

	constructor(
		private readonly authService: AuthService,
		private readonly notifications: NotificationService,
	) {}

	@Post("/")
	async send(@BodyParams() request: SendNotificationRequest, @HeaderParams("authorization") authorization?: string) {
		await this.authService.requireAdminSession(authorization);
		const title = request.title.trim();
		const body = request.body.trim();
		if (!title || !body) {
			throw new BadRequest("A title and a message are required.");
		}
		const url = request.url?.trim() || null;
		if (url && (!url.startsWith("/") || url.startsWith("//") || url.includes("\\"))) {
			throw new BadRequest("The link must be a path inside Flixer, such as /media/<id>.");
		}
		const userIds = (request.userIds ?? []).filter((id) => AuthService.isUuid(id)).map((id) => id.toLowerCase());
		if ((request.userIds?.length ?? 0) > 0 && userIds.length === 0) {
			throw new BadRequest("The selected users are not valid.");
		}
		return this.notifications.send({ kind: "admin", title, body, url }, userIds);
	}
}
