export interface RedisConnection {
	addr: string;
	username: string;
	password: string;
	db: number;
	tls: boolean;
}

const DEFAULT_PORT = "6379";

/** Splits a redis:// or rediss:// URL into the pieces clients take. Assumes the URL passed validateRedisUrl. */
export function parseRedisUrl(value: string): RedisConnection {
	const url = new URL(value);
	const db = url.pathname.replace(/^\//, "");
	return {
		addr: `${url.hostname}:${url.port || DEFAULT_PORT}`,
		username: decodeURIComponent(url.username),
		password: decodeURIComponent(url.password),
		db: db === "" ? 0 : Number(db),
		tls: url.protocol === "rediss:",
	};
}
