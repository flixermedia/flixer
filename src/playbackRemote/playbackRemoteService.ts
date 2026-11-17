import { Inject, Injectable, logger } from "@tsed/di";
import { PlatformApplication } from "@tsed/platform-http";
import type { Server } from "node:http";
import { AuthService } from "../api/auth/authService.ts";
import { PLAYBACK_REMOTE_PATH, PlaybackRemoteSocketServer } from "./playbackRemoteSocketServer.ts";

@Injectable()
export class PlaybackRemoteService {
	private socketServer?: PlaybackRemoteSocketServer;

	constructor(
		private readonly authService: AuthService,
		@Inject(PlatformApplication) private readonly platformApp: PlatformApplication<{ server?: Server }>,
	) {}

	$onReady(): void {
		const server = this.platformApp.getApp().server;
		if (!server) {
			logger().warn("Remote playback is unavailable: the HTTP server could not be located.");
			return;
		}
		this.socketServer = new PlaybackRemoteSocketServer(async (token) => (await this.authService.requireAuthenticatedSession(`Bearer ${token}`)).user.id);
		this.socketServer.attach(server);
		logger().info(`Remote playback is available on ${PLAYBACK_REMOTE_PATH}.`);
	}

	$onDestroy(): void {
		this.socketServer?.close();
		this.socketServer = undefined;
	}
}
