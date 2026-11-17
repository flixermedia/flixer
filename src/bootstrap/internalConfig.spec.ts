import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { signIndexerRequest } from "../api/indexer/indexerAuth.js";
import { AppConfig, setAppConfig } from "../config/store/appConfig.js";
import { ConfigStore } from "../config/store/configStore.js";
import { parseRedisUrl } from "../config/store/redisConfig.js";
import { ensureSecrets, publishAppSecret } from "../config/store/sharedSecret.js";
import { startBootstrapServer, stopBootstrapServer } from "./bootstrapServer.js";
import { internalConfigPath } from "./internalConfig.js";

const ENV = ["DATABASE_URL", "JWT_SECRET", "APP_SECRET", "REDIS_URL", "APP_SECRET_FILE"];

describe("internal config and shared secrets", () => {
	let directory: string;
	let store: ConfigStore;
	let config: AppConfig;
	let saved: Record<string, string | undefined>;

	beforeEach(() => {
		directory = mkdtempSync(join(tmpdir(), "flixer-internal-"));
		saved = Object.fromEntries(ENV.map((key) => [key, process.env[key]]));
		for (const key of ENV) {
			delete process.env[key];
		}
		store = new ConfigStore(directory);
		config = new AppConfig(store);
		setAppConfig(config);
	});

	afterEach(() => {
		setAppConfig(undefined);
		store.close();
		for (const key of ENV) {
			if (saved[key] === undefined) {
				delete process.env[key];
			} else {
				process.env[key] = saved[key];
			}
		}
		rmSync(directory, { recursive: true, force: true });
	});

	it("parses redis URLs", () => {
		expect(parseRedisUrl("redis://redis")).toEqual({ addr: "redis:6379", username: "", password: "", db: 0, tls: false });
		expect(parseRedisUrl("rediss://app:p%40ss@cache.example.com:6380/2")).toEqual({ addr: "cache.example.com:6380", username: "app", password: "p@ss", db: 2, tls: true });
	});

	it("rejects malformed redis URLs", () => {
		expect(() => store.setMany({ redisUrl: "http://redis" })).toThrow();
		expect(() => store.setMany({ redisUrl: "redis://redis/notanumber" })).toThrow();
	});

	it("generates missing secrets once and keeps them across restarts", () => {
		ensureSecrets(config);
		const jwt = store.get("jwtSecret");
		const stream = store.get("appSecret");
		expect(Buffer.byteLength(jwt ?? "")).toBeGreaterThanOrEqual(32);
		expect(stream).not.toBe(jwt);
		ensureSecrets(config);
		expect(store.get("jwtSecret")).toBe(jwt);
		expect(store.get("appSecret")).toBe(stream);
	});

	it("never replaces secrets that come from the environment", () => {
		process.env.JWT_SECRET = "j".repeat(40);
		process.env.APP_SECRET = "s".repeat(40);
		ensureSecrets(config);
		expect(store.has("jwtSecret")).toBe(false);
		expect(store.has("appSecret")).toBe(false);
	});

	it("publishes the app secret to the shared file", () => {
		const file = join(directory, "shared", "app-secret");
		ensureSecrets(config);
		expect(publishAppSecret(config, file)).toBe(true);
		expect(readFileSync(file, "utf8")).toBe(store.get("appSecret"));
		expect(statSync(file).mode & 0o777).toBe(0o644);
		writeFileSync(file, "stale");
		publishAppSecret(config, file);
		expect(readFileSync(file, "utf8")).toBe(store.get("appSecret"));
		expect(publishAppSecret(config, undefined)).toBe(false);
	});

	describe("signed endpoint during bootstrap", () => {
		let server: Server;
		let base: string;

		beforeEach(async () => {
			ensureSecrets(config);
			server = await startBootstrapServer(0);
			base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
		});

		afterEach(() => stopBootstrapServer(server));

		it("serves the indexer its Redis settings to a correctly signed request", async () => {
			store.setMany({ redisUrl: "redis://:secret@redis:6379/1" });
			const path = internalConfigPath("indexer");
			const response = await fetch(base + path, { headers: signIndexerRequest("GET", path, new Uint8Array()) });
			expect(response.status).toBe(200);
			const body = await response.json();
			expect(body.redis).toEqual({ addr: "redis:6379", username: "", password: "secret", db: 1, tls: false });
			expect(body.version).toBe(store.version());
		});

		it("returns a null redis when none is configured", async () => {
			const path = internalConfigPath("indexer");
			const response = await fetch(base + path, { headers: signIndexerRequest("GET", path, new Uint8Array()) });
			expect((await response.json()).redis).toBeNull();
		});

		it("serves setup routes while unprotected, rejects bad bodies and oversized requests", async () => {
			const post = (path: string, body: string) => fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body });
			expect((await fetch(base + "/api/setup/progress")).status).toBe(200);
			expect((await post("/api/setup/steps/redis", "{not json")).status).toBe(400);
			expect((await post("/api/setup/steps/redis", JSON.stringify({ redisUrl: "redis://redis:6379" }))).status).toBe(200);
			expect(store.get("redisUrl")).toBe("redis://redis:6379");
			expect((await post("/api/setup/steps/redis", JSON.stringify({ x: "a".repeat(70_000) }))).status).toBe(413);
			expect((await fetch(base + "/api/other")).status).toBe(503);
		});

		it("locks setup routes once setup is completed", async () => {
			store.setSetupState("completed");
			expect((await fetch(base + "/api/setup/progress")).status).toBe(403);
		});

		it("rejects unsigned, wrongly signed and expired requests", async () => {
			const path = internalConfigPath("indexer");
			expect((await fetch(base + path)).status).toBe(401);
			const wrongPath = signIndexerRequest("GET", "/api/indexer/settings", new Uint8Array());
			expect((await fetch(base + path, { headers: wrongPath })).status).toBe(401);
			const old = signIndexerRequest("GET", path, new Uint8Array(), Date.now() - 3_600_000);
			expect((await fetch(base + path, { headers: old })).status).toBe(401);
		});
	});
});
