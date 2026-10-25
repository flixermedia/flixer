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
	indexerUrl: { key: "indexer_url", env: "INDEXER_URL", envAliases: ["INDEXER_INTERNAL_URL"], secret: false, defaultValue: "http://localhost:8092", validate: validateHttpUrl },
	streamerInternalUrl: { key: "streamer_internal_url", env: "STREAMER_INTERNAL_URL", secret: false, defaultValue: "http://localhost:8091", validate: validateHttpUrl },
	streamerPublicUrl: { key: "streamer_public_url", env: "STREAMER_PUBLIC_URL", secret: false, defaultValue: "" },
} as const satisfies Record<string, ConfigKeyDefinition>;

export type ConfigName = keyof typeof CONFIG_KEYS;
