import { Inject, Injectable } from "@tsed/di";
import { BadGateway, GatewayTimeout, NotFound } from "@tsed/exceptions";
import { createHmac } from "node:crypto";
import { DataSource, In } from "typeorm";
import { DefaultDataSource } from "../../datasources/defaultDataSource.datasource.js";
import { User } from "../../entities/user.entity.js";
import { appConfig } from "../../config/store/appConfig.js";
import { AuthService } from "../auth/authService.js";

const REQUEST_TIMEOUT_MS = 5_000;

interface StreamerSession {
	id: string;
	userId?: string;
	[key: string]: unknown;
}

interface StreamerSessions {
	transcodingAvailable: boolean;
	maxTranscodes: number;
	activeTranscodes: number;
	sessions: StreamerSession[];
}

/** Talks to flixer-streamer's internal admin API to list and cancel playback sessions. */
@Injectable()
export class StreamsService {

	constructor(
		private readonly authService: AuthService,
		@Inject(DefaultDataSource) private readonly dataSource: DataSource,
	) {}

	async listSessions(authorization?: string) {
		await this.authService.requireAdmin(authorization);
		return this.fetchSessions();
	}

	/** Same as listSessions for callers that have already checked access, such as the live socket. */
	async fetchSessions() {
		const response = await this.request("/streamer/admin/sessions", "GET");
		const data = (await response.json()) as StreamerSessions;

		const userIds = [...new Set(data.sessions.map((session) => session.userId).filter((id): id is string => !!id))];
		const users = userIds.length ? await this.dataSource.getRepository(User).findBy({ id: In(userIds) }) : [];
		const names = new Map(users.map((user) => [user.id, { username: user.username, displayName: user.displayName ?? user.username }]));

		return {
			...data,
			sessions: data.sessions.map((session) => ({ ...session, user: session.userId ? names.get(session.userId) ?? null : null })),
		};
	}

	async cancelSession(sessionId: string, authorization?: string): Promise<void> {
		await this.authService.requireAdmin(authorization);
		const response = await this.request(`/streamer/admin/sessions/${encodeURIComponent(sessionId)}`, "DELETE", [404]);
		if (response.status === 404) {
			throw new NotFound("Session not found. It may have already ended.");
		}
	}

	private async request(path: string, method: string, allowedStatuses: number[] = []): Promise<Response> {
		const baseUrl = (appConfig().get("streamerInternalUrl") || "http://localhost:8091").replace(/\/+$/, "");
		let response: Response;
		try {
			response = await fetch(`${baseUrl}${path}`, {
				method,
				headers: { authorization: `Bearer ${this.adminKey()}` },
				signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
			});
		} catch (error) {
			if (error instanceof Error && error.name === "TimeoutError") {
				throw new GatewayTimeout("flixer-streamer did not respond in time.");
			}
			throw new BadGateway("flixer-streamer is unreachable.");
		}
		if (!response.ok && !allowedStatuses.includes(response.status)) {
			throw new BadGateway(`flixer-streamer returned ${response.status}.`);
		}
		return response;
	}

	// Must match the streamer's AdminKey derivation.
	private adminKey(): string {
		const secret = appConfig().get("appSecret") ?? "";
		if (Buffer.byteLength(secret) < 32) {
			throw new Error("APP_SECRET must be set to at least 32 bytes to manage streamer sessions.");
		}
		return createHmac("sha256", secret).update("flixer-streamer:admin:v1").digest("hex");
	}
}
