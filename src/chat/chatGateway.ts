import { Inject, Injectable, logger } from "@tsed/di";
import { PlatformApplication } from "@tsed/platform-http";
import type { Server } from "node:http";
import { AuthService } from "../api/auth/authService.js";
import { ChatService } from "./chatService.js";
import { CHAT_PATH, ChatSocketServer } from "./chatSocketServer.js";

/** Owns the realtime chat WebSocket. */
@Injectable()
export class ChatGateway {
	private socketServer?: ChatSocketServer;

	constructor(
		private readonly authService: AuthService,
		private readonly chat: ChatService,
		@Inject(PlatformApplication) private readonly platformApp: PlatformApplication<{ server?: Server }>,
	) {}

	$onReady(): void {
		const server = this.platformApp.getApp().server;
		if (!server) {
			logger().warn("Realtime chat is unavailable: the HTTP server could not be located.");
			return;
		}
		this.socketServer = new ChatSocketServer(
			async (token) => (await this.authService.getAuthenticatedUser(`Bearer ${token}`)).id,
			this.chat,
		);
		this.socketServer.attach(server);
		logger().info(`Realtime chat is available on ${CHAT_PATH}.`);
	}

	$onDestroy(): void {
		this.socketServer?.close();
		this.socketServer = undefined;
	}
}
