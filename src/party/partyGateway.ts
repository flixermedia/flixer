import { Injectable, logger } from "@tsed/di";
import { Inject } from "@tsed/di";
import { PlatformApplication } from "@tsed/platform-http";
import type { Server } from "node:http";
import { MediaAccessService } from "../api/access/mediaAccessService.ts";
import { AuthService } from "../api/auth/authService.ts";
import { CallService } from "../chat/callService.ts";
import { PartiesService } from "./partiesService.ts";
import { PARTY_PATH, PartySocketServer, personFrom } from "./partySocketServer.ts";

/** Owns the party WebSocket. */
@Injectable()
export class PartyGateway {

	private socketServer?: PartySocketServer;

	constructor(
		private readonly authService: AuthService,
		private readonly access: MediaAccessService,
		private readonly parties: PartiesService,
		private readonly calls: CallService,
		@Inject(PlatformApplication) private readonly platformApp: PlatformApplication<{ server?: Server }>,
	) {}

	$onReady(): void {
		const server = this.platformApp.getApp().server;
		if (!server) {
			logger().warn("Watch parties are unavailable: the HTTP server could not be located.");
			return;
		}
		this.socketServer = new PartySocketServer(async (token) => personFrom(await this.authService.getAuthenticatedUser(`Bearer ${token}`)), this.parties, async (token, itemId) => {
			const policy = await this.access.resolve(`Bearer ${token}`);
			return this.access.isVisible(policy, itemId);
		}, this.calls);
		this.socketServer.attach(server);
		logger().info(`Watch and listen parties are available on ${PARTY_PATH}.`);
	}

	$onDestroy(): void {
		this.socketServer?.close();
		this.socketServer = undefined;
	}
}
