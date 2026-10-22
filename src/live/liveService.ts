import { Inject, Injectable, logger } from "@tsed/di";
import { PlatformApplication } from "@tsed/platform-http";
import type { Server } from "node:http";
import { AdminIndexerService } from "../api/indexer/adminIndexerService.js";
import { AuthService } from "../api/auth/authService.js";
import { DevicesService } from "../api/devices/devicesService.js";
import { NetworkSharesService } from "../api/networkShares/networkSharesService.js";
import { OverviewService } from "../api/overview/overviewService.js";
import { StreamsService } from "../api/streams/streamsService.js";
import { LiveHub, type LiveTopic } from "./liveHub.js";
import { LIVE_PATH, LiveSocketServer } from "./liveSocketServer.js";

/** Owns the live admin socket and the hub that feeds it. Controllers call invalidate() after changing something. */
@Injectable()
export class LiveService {

	private readonly hub = new LiveHub();
	private socketServer?: LiveSocketServer;

	constructor(
		private readonly authService: AuthService,
		private readonly overview: OverviewService,
		private readonly streams: StreamsService,
		private readonly devices: DevicesService,
		private readonly indexer: AdminIndexerService,
		private readonly shares: NetworkSharesService,
		@Inject(PlatformApplication) private readonly platformApp: PlatformApplication<{ server?: Server }>,
	) {
		this.hub.define("overview", { intervalMs: 10_000, load: () => this.overview.get() });
		this.hub.define("streams", { intervalMs: 2_000, load: () => this.streams.fetchSessions() });
		this.hub.define("devices", { intervalMs: 15_000, perSession: true, load: ({ sessionId }) => this.devices.list(sessionId) });
		this.hub.define("indexer", { intervalMs: 2_000, load: () => this.indexer.status() });
		this.hub.define("shares", { intervalMs: 3_000, load: async () => this.shares.list() });
	}

	/** Pushes fresh data for a topic to its subscribers right away. */
	invalidate(...topics: LiveTopic[]): void {
		for (const topic of topics) {
			this.hub.invalidate(topic);
		}
	}

	$onReady(): void {
		const server = this.platformApp.getApp().server;
		if (!server) {
			logger().warn("Live updates are unavailable: the HTTP server could not be located.");
			return;
		}

		this.socketServer = new LiveSocketServer(async (token) => {
			const { session } = await this.authService.requireAdminSession(`Bearer ${token}`);
			return { sessionId: session.id };
		}, this.hub);
		this.socketServer.attach(server);
		logger().info(`Live admin updates are available on ${LIVE_PATH}.`);
	}

	$onDestroy(): void {
		this.socketServer?.close();
		this.socketServer = undefined;
	}
}
