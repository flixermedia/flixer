import { existsSync } from "node:fs";
/** How a configuration value is checked before it is saved. Format checks only; live connectivity tests belong to the setup steps. */
export type ConfigValidator = (value: string) => string | null;

export interface ConfigKeyDefinition {
	/** Key in the SQLite store. */
	key: string;
	/** Environment variable that overrides the stored value for this key only. */
	env: string;
	/** Secrets are encrypted at rest and never returned by public endpoints. */
	secret: boolean;
	/** Value used when neither the environment nor the store has one. */
	defaultValue?: string;
	/** Other environment variables read when `env` is unset, in order. */
	envAliases?: string[];
	validate?: ConfigValidator;
}

/**
 * Sibling services are reachable by name on the Compose network and on localhost everywhere else. In a Coder workspace
 * only the PostgreSQL, Redis and Meilisearch sidecars have their own names; the indexer and streamer run inside the workspace itself.
 */
const serviceHost = (name: string): string => {
	if (process.env.CODER === "true" && name !== "postgres" && name !== "redis" && name !== "meilisearch") {
		return "localhost";
	}
	return existsSync("/.dockerenv") ? name : "localhost";
};

/** Suggested when Redis was never configured; not applied implicitly so an unconfigured install still reports no Redis. */
export const suggestedRedisUrl = (): string => `redis://${serviceHost("redis")}:6379`;

/** Bundled PostgreSQL connection used by the quick setup flow. */
export const suggestedDatabaseUrl = (): string => `postgres://flixer:flixer@${serviceHost("postgres")}:5432/flixer`;

const MIN_SECRET_BYTES = 32;

export const validateSecret: ConfigValidator = (value) =>
	Buffer.byteLength(value) >= MIN_SECRET_BYTES ? null : `Must be at least ${MIN_SECRET_BYTES} bytes long.`;

export const validateHttpUrl: ConfigValidator = (value) => {
	try {
		const url = new URL(value);
		return url.protocol === "http:" || url.protocol === "https:" ? null : "Must start with http:// or https://.";
	} catch {
		return "Must be a valid URL.";
	}
};

export const validatePostgresUrl: ConfigValidator = (value) => {
	try {
		const url = new URL(value);
		return url.protocol === "postgres:" || url.protocol === "postgresql:" ? null : "Must start with postgres:// or postgresql://.";
	} catch {
		return "Must be a valid PostgreSQL connection URL.";
	}
};

export const validateRedisUrl: ConfigValidator = (value) => {
	try {
		const url = new URL(value);
		if (url.protocol !== "redis:" && url.protocol !== "rediss:") {
			return "Must start with redis:// or rediss://.";
		}
		const db = url.pathname.replace(/^\//, "");
		return url.hostname && (db === "" || /^\d+$/.test(db)) ? null : "Must be redis://[user:password@]host[:port][/database-number].";
	} catch {
		return "Must be a valid Redis connection URL.";
	}
};

/**
 * Everything the bootstrap store knows about. Application data and admin-editable settings stay in PostgreSQL;
 * only values needed before PostgreSQL is reachable, or shared with other services, belong here.
 */
export const CONFIG_KEYS = {
	databaseUrl: { key: "database_url", env: "DATABASE_URL", secret: true, validate: validatePostgresUrl },
	redisUrl: { key: "redis_url", env: "REDIS_URL", secret: true, validate: validateRedisUrl },
	jwtSecret: { key: "jwt_secret", env: "JWT_SECRET", secret: true, validate: validateSecret },
	appSecret: { key: "app_secret", env: "APP_SECRET", envAliases: ["STREAM_TOKEN_SECRET"], secret: true, validate: validateSecret },
	publicUrl: { key: "public_url", env: "FLIXER_PUBLIC_URL", secret: false, validate: validateHttpUrl },
	appUrl: { key: "app_url", env: "APP_URL", secret: false, validate: validateHttpUrl },
	passkeyRpId: { key: "passkey_rp_id", env: "PASSKEY_RP_ID", secret: false },
	passkeyRpName: { key: "passkey_rp_name", env: "PASSKEY_RP_NAME", secret: false, defaultValue: "Flixer" },
	passkeyOrigins: { key: "passkey_origins", env: "PASSKEY_ORIGINS", secret: false },
	indexerUrl: { key: "indexer_url", env: "INDEXER_URL", envAliases: ["INDEXER_INTERNAL_URL"], secret: false, defaultValue: `http://${serviceHost("indexer")}:8092`, validate: validateHttpUrl },
	streamerInternalUrl: { key: "streamer_internal_url", env: "STREAMER_INTERNAL_URL", secret: false, defaultValue: `http://${serviceHost("streamer")}:8091`, validate: validateHttpUrl },
	meilisearchUrl: { key: "meilisearch_url", env: "MEILISEARCH_URL", secret: false, defaultValue: `http://${serviceHost("meilisearch")}:7700`, validate: validateHttpUrl },
	aiUrl: { key: "ai_url", env: "FLIXER_AI_URL", secret: false, defaultValue: `http://${serviceHost("ai")}:8094`, validate: validateHttpUrl },
	loggerUrl: { key: "logger_url", env: "FLIXER_LOGGER_URL", secret: false },
	loggerManageToken: { key: "logger_manage_token", env: "FLIXER_LOGGER_MANAGE_TOKEN", secret: true, validate: validateSecret },
	loggerManageExpiry: { key: "logger_manage_expiry", env: "FLIXER_LOGGER_MANAGE_EXPIRY", secret: false },
	loggerOwnerToken: { key: "logger_owner_token", env: "FLIXER_LOGGER_OWNER_TOKEN", secret: true, validate: validateSecret },
	loggerOwnerUrl: { key: "logger_owner_url", env: "FLIXER_LOGGER_OWNER_URL", secret: false },
	loggerPendingPairingUrl: { key: "logger_pending_pairing_url", env: "FLIXER_LOGGER_PENDING_PAIRING_URL", secret: false },
	loggerPendingPairingToken: { key: "logger_pending_pairing_token", env: "FLIXER_LOGGER_PENDING_PAIRING_TOKEN", secret: true, validate: validateSecret },
	loggerPendingPairingExpiry: { key: "logger_pending_pairing_expiry", env: "FLIXER_LOGGER_PENDING_PAIRING_EXPIRY", secret: false },
	loggerLocalDeploymentId: { key: "logger_local_deployment_id", env: "FLIXER_LOGGER_LOCAL_DEPLOYMENT_ID", secret: false },
	loggerLocalPending: { key: "logger_local_pending", env: "FLIXER_LOGGER_LOCAL_PENDING", secret: false },
	loggerLocalManaged: { key: "logger_local_managed", env: "FLIXER_LOGGER_LOCAL_MANAGED", secret: false },
	loggerLocalRenewalToken: { key: "logger_local_renewal_token", env: "FLIXER_LOGGER_LOCAL_RENEWAL_TOKEN", secret: true, validate: validateSecret },
	loggerLocalRenewalExpiry: { key: "logger_local_renewal_expiry", env: "FLIXER_LOGGER_LOCAL_RENEWAL_EXPIRY", secret: false },
	loggerLocalRenewalBinding: { key: "logger_local_renewal_binding", env: "FLIXER_LOGGER_LOCAL_RENEWAL_BINDING", secret: false },
	loggerIngestToken: { key: "logger_ingest_token", env: "FLIXER_LOGGER_INGEST_TOKEN", secret: true, validate: validateSecret },
	loggerIngestExpiry: { key: "logger_ingest_expiry", env: "FLIXER_LOGGER_INGEST_EXPIRY", secret: false },
	loggerIngestId: { key: "logger_ingest_id", env: "FLIXER_LOGGER_INGEST_ID", secret: false },
	loggerIngestApp: { key: "logger_ingest_app", env: "FLIXER_LOGGER_INGEST_APP", secret: false },
	loggerAiIngestToken: { key: "logger_ai_ingest_token", env: "FLIXER_LOGGER_AI_INGEST_TOKEN", secret: true, validate: validateSecret },
	loggerAiIngestExpiry: { key: "logger_ai_ingest_expiry", env: "FLIXER_LOGGER_AI_INGEST_EXPIRY", secret: false },
	loggerAiIngestId: { key: "logger_ai_ingest_id", env: "FLIXER_LOGGER_AI_INGEST_ID", secret: false },
	loggerWebIngestToken: { key: "logger_web_ingest_token", env: "FLIXER_LOGGER_WEB_INGEST_TOKEN", secret: true, validate: validateSecret },
	loggerWebIngestExpiry: { key: "logger_web_ingest_expiry", env: "FLIXER_LOGGER_WEB_INGEST_EXPIRY", secret: false },
	loggerWebIngestId: { key: "logger_web_ingest_id", env: "FLIXER_LOGGER_WEB_INGEST_ID", secret: false },
	loggerIndexerIngestToken: { key: "logger_indexer_ingest_token", env: "FLIXER_LOGGER_INDEXER_INGEST_TOKEN", secret: true, validate: validateSecret },
	loggerIndexerIngestExpiry: { key: "logger_indexer_ingest_expiry", env: "FLIXER_LOGGER_INDEXER_INGEST_EXPIRY", secret: false },
	loggerIndexerIngestId: { key: "logger_indexer_ingest_id", env: "FLIXER_LOGGER_INDEXER_INGEST_ID", secret: false },
	loggerStreamerIngestToken: { key: "logger_streamer_ingest_token", env: "FLIXER_LOGGER_STREAMER_INGEST_TOKEN", secret: true, validate: validateSecret },
	loggerStreamerIngestExpiry: { key: "logger_streamer_ingest_expiry", env: "FLIXER_LOGGER_STREAMER_INGEST_EXPIRY", secret: false },
	loggerStreamerIngestId: { key: "logger_streamer_ingest_id", env: "FLIXER_LOGGER_STREAMER_INGEST_ID", secret: false },
	loggerUpdaterIngestToken: { key: "logger_updater_ingest_token", env: "FLIXER_LOGGER_UPDATER_INGEST_TOKEN", secret: true, validate: validateSecret },
	loggerUpdaterIngestExpiry: { key: "logger_updater_ingest_expiry", env: "FLIXER_LOGGER_UPDATER_INGEST_EXPIRY", secret: false },
	loggerUpdaterIngestId: { key: "logger_updater_ingest_id", env: "FLIXER_LOGGER_UPDATER_INGEST_ID", secret: false },
	streamerPublicUrl: { key: "streamer_public_url", env: "STREAMER_PUBLIC_URL", secret: false, defaultValue: "" },
} as const satisfies Record<string, ConfigKeyDefinition>;

export type ConfigName = keyof typeof CONFIG_KEYS;
