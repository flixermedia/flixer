import { BadRequest, ServiceUnavailable } from "@tsed/exceptions";
import { Inject, Injectable } from "@tsed/di";
import { DataSource, In } from "typeorm";
import { DefaultDataSource } from "../../datasources/defaultDataSource.datasource.js";
import { Setting } from "../../entities/setting.entity.js";
import { appConfig } from "../../config/store/appConfig.js";
import { aiSignature } from "./aiAuth.js";
import type { UpdateAiConfigurationRequest } from "./aiAdminRequests.js";

const AI_SETTING_KEYS = {
	enabled: "ai_enabled",
	profile: "ai_profile",
	allowDownloads: "ai_allow_downloads",
	cacheRefreshIntervalMinutes: "ai_cache_refresh_interval_minutes",
} as const;
const PROFILE_NAMES = ["auto", "classic", "micro", "mini"] as const;

export interface AiAdminConfiguration {
	enabled: boolean;
	profile: (typeof PROFILE_NAMES)[number];
	allowDownloads: boolean;
	cacheRefreshIntervalMinutes: number;
}

@Injectable()
export class AiAdminService {
	constructor(@Inject(DefaultDataSource) private readonly dataSource: DataSource) {}

	async configuration(): Promise<AiAdminConfiguration> {
		const rows = await this.dataSource.getRepository(Setting).findBy({
			key: In(Object.values(AI_SETTING_KEYS)),
		});
		const values = new Map(rows.map(({ key, value }) => [key, value]));
		const profile = values.get(AI_SETTING_KEYS.profile);
		const enabled = values.get(AI_SETTING_KEYS.enabled);
		const allowDownloads = values.get(AI_SETTING_KEYS.allowDownloads);
		const cacheRefreshIntervalMinutes = values.get(AI_SETTING_KEYS.cacheRefreshIntervalMinutes);
		return {
			enabled: enabled === true,
			profile: typeof profile === "string" && PROFILE_NAMES.includes(profile as AiAdminConfiguration["profile"]) ? (profile as AiAdminConfiguration["profile"]) : "auto",
			allowDownloads: allowDownloads !== false,
			cacheRefreshIntervalMinutes: typeof cacheRefreshIntervalMinutes === "number" && Number.isInteger(cacheRefreshIntervalMinutes) && cacheRefreshIntervalMinutes >= 1 && cacheRefreshIntervalMinutes <= 1440 ? cacheRefreshIntervalMinutes : 10,
		};
	}

	async saveConfiguration(request: UpdateAiConfigurationRequest): Promise<AiAdminConfiguration> {
		if (typeof request.enabled !== "boolean" || typeof request.allowDownloads !== "boolean" || !PROFILE_NAMES.includes(request.profile) || !Number.isInteger(request.cacheRefreshIntervalMinutes) || request.cacheRefreshIntervalMinutes < 1 || request.cacheRefreshIntervalMinutes > 1440) {
			throw new BadRequest("Invalid AI configuration.");
		}
		await this.dataSource.transaction(async (manager) => {
			const repository = manager.getRepository(Setting);
			for (const [field, key] of Object.entries(AI_SETTING_KEYS) as Array<[keyof AiAdminConfiguration, string]>) {
				const setting = await repository.findOneBy({ key });
				if (!setting) {
					throw new Error(`The ${key} setting is missing. Restart Flixer to synchronize settings.`);
				}
				setting.value = request[field];
				await repository.save(setting);
			}
		});
		return this.configuration();
	}

	async status(): Promise<Record<string, unknown>> {
		const configuration = await this.configuration();
		try {
			const serviceStatus = await this.callAi<Record<string, unknown>>("/admin/status");
			const events = await this.callAi<{ events: Array<Record<string, unknown>>; nextId: number }>("/admin/events");
			return { configuration, available: true, service: serviceStatus, events: events.events, nextEventId: events.nextId };
		} catch (error) {
			if (!(error instanceof ServiceUnavailable)) throw error;
			return { configuration, available: false, error: error.message, service: null, events: [], nextEventId: 0 };
		}
	}

	async applyConfiguration(request: UpdateAiConfigurationRequest): Promise<{ applied: boolean; configuration: AiAdminConfiguration }> {
		const configuration = await this.saveConfiguration(request);
		try {
			await this.callAi("/admin/config", {
				enabled: configuration.enabled,
				profile: configuration.profile,
				allow_downloads: configuration.allowDownloads,
				cache_refresh_interval_minutes: configuration.cacheRefreshIntervalMinutes,
			});
			return { applied: true, configuration };
		} catch (error) {
			if (!(error instanceof ServiceUnavailable)) throw error;
			return { applied: false, configuration };
		}
	}

	async retry(): Promise<void> {
		if (!(await this.configuration()).enabled) {
			throw new BadRequest("Enable AI recommendations before retrying the model.");
		}
		await this.callAi("/admin/retry", {});
	}

	async forceRefreshRecommendations(userId: string): Promise<{ items: Array<{ id: string; score: number; reason?: string | null }> }> {
		if (!(await this.configuration()).enabled) {
			throw new BadRequest("Enable AI recommendations before refreshing a user's recommendations.");
		}
		return this.callAi(`/admin/users/${encodeURIComponent(userId)}/recommendations/refresh`, {}, 120_000);
	}

	async runtimeConfiguration(): Promise<AiAdminConfiguration> {
		return this.configuration();
	}

	private async callAi<T = void>(path: string, body?: Record<string, unknown>, timeoutMs = 8_000): Promise<T> {
		const baseUrl = appConfig().get("aiUrl") || "http://ai:8094";
		const secret = appConfig().get("appSecret");
		if (!secret || Buffer.byteLength(secret) < 32) {
			throw new ServiceUnavailable("AI service authentication is not configured.");
		}
		const method = body === undefined ? "GET" : "POST";
		const serializedBody = body === undefined ? "" : JSON.stringify(body);
		const normalizedPath = path.startsWith("/admin/") ? path : `/admin${path}`;
		const timestamp = Math.floor(Date.now() / 1000).toString();
		const signature = aiSignature(secret, timestamp, method, normalizedPath, Buffer.from(serializedBody));

		let response: Response;
		try {
			const url = new URL(normalizedPath, `${baseUrl.replace(/\/+$/, "")}/`);
			if (url.protocol !== "http:" && url.protocol !== "https:") {
				throw new Error("AI service URL must use HTTP or HTTPS.");
			}
			response = await fetch(url, {
				method,
				headers: {
					"x-flixer-ai-timestamp": timestamp,
					"x-flixer-ai-signature": signature,
					...(body === undefined ? {} : { "content-type": "application/json" }),
				},
				...(body === undefined ? {} : { body: serializedBody }),
				signal: AbortSignal.timeout(timeoutMs),
			});
		} catch {
			throw new ServiceUnavailable("The AI service could not be reached.");
		}
		if (!response.ok) {
			throw new ServiceUnavailable(`The AI service returned HTTP ${response.status}.`);
		}
		if (response.status === 204) return undefined as T;
		try {
			return (await response.json()) as T;
		} catch {
			throw new ServiceUnavailable("The AI service returned an invalid response.");
		}
	}
}
