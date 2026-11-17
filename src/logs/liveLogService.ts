import { Inject, Injectable, logger } from "@tsed/di";
import { PlatformApplication } from "@tsed/platform-http";
import type { Server } from "node:http";
import { AuthService } from "../api/auth/authService.js";
import { LIVE_LOG_PATH, LiveLogSocketServer } from "./liveLogSocketServer.js";

/** Attaches the live log WebSocket to flixer's HTTP server once it is listening. */
@Injectable()
export class LiveLogService {

	private socketServer?: LiveLogSocketServer;

	constructor(
		private readonly authService: AuthService,
		@Inject(PlatformApplication) private readonly platformApp: PlatformApplication<{ server?: Server }>,
	) {}

	$onReady(): void {
		const server = this.platformApp.getApp().server;
		if (!server) {
			logger().warn("Live logs are unavailable: the HTTP server could not be located.");
			return;
		}

		this.socketServer = new LiveLogSocketServer((token) => this.authService.requireAdmin(`Bearer ${token}`));
		this.socketServer.attach(server);
		logger().info(`Live logs are streaming on ${LIVE_LOG_PATH}.`);
	}

	$onDestroy(): void {
		this.socketServer?.close();
		this.socketServer = undefined;
	}
}
