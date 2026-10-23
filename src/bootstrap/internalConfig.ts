import { appConfig, type AppConfig } from "../config/store/appConfig.js";
import { parseRedisUrl, type RedisConnection } from "../config/store/redisConfig.js";

export const INTERNAL_CONFIG_SERVICES = ["indexer"] as const;
export type InternalConfigService = (typeof INTERNAL_CONFIG_SERVICES)[number];

export interface IndexerRuntimeConfig {
	/** Increases on every saved change; a service that sees a new number should reload. */
	version: number;
	/** Null when Redis is not configured here, so the service keeps its own setting. */
	redis: RedisConnection | null;
}

export function internalConfigPath(service: InternalConfigService): string {
	return `/api/internal/config/${service}`;
}

export function isInternalConfigService(value: string): value is InternalConfigService {
	return (INTERNAL_CONFIG_SERVICES as readonly string[]).includes(value);
}

/** Only what that service needs. Callers must have verified the request signature. */
export function indexerRuntimeConfig(config: AppConfig = appConfig()): IndexerRuntimeConfig {
	const redisUrl = config.get("redisUrl");
	return { version: config.persistent?.version() ?? 0, redis: redisUrl ? parseRedisUrl(redisUrl) : null };
}
