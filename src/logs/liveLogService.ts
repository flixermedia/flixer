import { Inject, Injectable, logger } from "@tsed/di";
import { PlatformApplication } from "@tsed/platform-http";
import type { Server } from "node:http";
import { AuthService } from "../api/auth/authService.js";
import { liveLogHub } from "./liveLogHub.js";
import { LIVE_LOG_PATH, LiveLogSocketServer } from "./liveLogSocketServer.js";
import { StreamerLogTailer } from "./streamerLogTailer.js";

/** Attaches the live log WebSocket to flixer's HTTP server once it is listening. */
@Injectable()
export class LiveLogService {

	private socketServer?: LiveLogSocketServer;
	private streamerTailer?: StreamerLogTailer;

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

		const logDir = process.env.LOG_DIR?.trim();
		if (logDir) {
			this.streamerTailer = new StreamerLogTailer(logDir, liveLogHub);
			this.streamerTailer.start();
		}
	}

	$onDestroy(): void {
		this.streamerTailer?.stop();
		this.streamerTailer = undefined;
		this.socketServer?.close();
		this.socketServer = undefined;
	}
}
