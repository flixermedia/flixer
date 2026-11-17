import { Inject, Injectable, logger } from "@tsed/di";
import { PlatformApplication } from "@tsed/platform-http";
import type { Server } from "node:http";
import { AuthService } from "../auth/authService.js";
import { NOTIFICATION_PATH, NotificationSocketServer } from "./notificationSocketServer.js";
import { NotificationService } from "./notificationService.js";

@Injectable()
export class NotificationGateway {

	private socketServer?: NotificationSocketServer;

	constructor(
		private readonly authService: AuthService,
		private readonly notifications: NotificationService,
		@Inject(PlatformApplication) private readonly platformApp: PlatformApplication<{ server?: Server }>,
	) {}

	$onReady(): void {
		const server = this.platformApp.getApp().server;
		if (!server) {
			logger().warn("Realtime notifications are unavailable: the HTTP server could not be located.");
			return;
		}
		this.socketServer = new NotificationSocketServer(
			async (token) => (await this.authService.getAuthenticatedUser(`Bearer ${token}`)).id,
			this.notifications,
		);
		this.socketServer.attach(server);
		logger().info(`Realtime notifications are available on ${NOTIFICATION_PATH}.`);
	}

	$onDestroy(): void {
		this.socketServer?.close();
		this.socketServer = undefined;
	}
}
