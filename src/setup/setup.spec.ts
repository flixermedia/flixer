import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { adoptExistingUsers, updateRuntime } from "../bootstrap/setupStatus.js";
import { AppConfig, setAppConfig } from "../config/store/appConfig.js";
import { ConfigStore } from "../config/store/configStore.js";
import { probeRedis } from "./redisProbe.js";
import { handleSetupRequest, type SetupRequestContext } from "./setupApi.js";
import type { Probes } from "./setupSteps.js";
import { resolveUrls } from "./urlRules.js";

const ENV = ["DATABASE_URL", "JWT_SECRET", "APP_SECRET", "REDIS_URL", "FLIXER_PUBLIC_URL", "APP_URL", "PASSKEY_RP_ID", "PASSKEY_ORIGINS", "INDEXER_URL", "INDEXER_INTERNAL_URL", "STREAMER_INTERNAL_URL", "STREAMER_PUBLIC_URL"];

describe("url rules", () => {
	it("derives the app url, rp id and origin from the public url", () => {
		expect(resolveUrls({ publicUrl: "https://flix.example.com/" })).toEqual({
			values: { publicUrl: "https://flix.example.com", appUrl: "https://flix.example.com", passkeyRpId: "flix.example.com", passkeyOrigins: "https://flix.example.com" },
		});
	});

	it("accepts a parent domain as rp id", () => {
		const result = resolveUrls({ publicUrl: "https://api.example.com", appUrl: "https://app.example.com", passkeyRpId: "example.com" });
		expect("values" in result && result.values.passkeyRpId).toBe("example.com");
	});

	it("rejects an rp id that does not cover the origins, IP addresses and insecure origins", () => {
		expect(resolveUrls({ publicUrl: "https://a.example.com", passkeyRpId: "other.com" })).toHaveProperty("errors.passkeyRpId");
		expect(resolveUrls({ publicUrl: "https://10.0.0.5" })).toHaveProperty("errors.passkeyRpId");
		expect(resolveUrls({ publicUrl: "http://flix.example.com" })).toHaveProperty("errors.passkeyOrigins");
		expect(resolveUrls({ publicUrl: "nonsense" })).toHaveProperty("errors.publicUrl");
	});

	it("allows http on localhost", () => {
		expect(resolveUrls({ publicUrl: "http://localhost:5173" })).toHaveProperty("values.passkeyRpId", "localhost");
	});
});

describe("redis probe", () => {
	let server: Server;
	let port: number;
	let received: string;

	function serve(reply: (data: string) => string) {
		return new Promise<void>((resolve) => {
			server = createServer((socket) => {
				socket.on("data", (data) => {
					received += data.toString();
					socket.write(reply(received));
				});
			}).listen(0, "127.0.0.1", () => {
				port = (server.address() as { port: number }).port;
				resolve();
			});
		});
	}

	beforeEach(() => {
		received = "";
	});

	afterEach(() => new Promise<void>((resolve) => server.close(() => resolve())));

	it("authenticates, selects the database and pings", async () => {
		await serve(() => "+OK\r\n+OK\r\n+PONG\r\n");
		expect(await probeRedis(`redis://user:pw@127.0.0.1:${port}/2`)).toEqual({ ok: true });
		expect(received).toContain("AUTH");
		expect(received).toContain("SELECT");
	});

	it("reports a server error without leaking the password", async () => {
		await serve(() => "-WRONGPASS invalid password hunter2\r\n");
		const result = await probeRedis(`redis://:hunter2@127.0.0.1:${port}`);
		expect(result.ok).toBe(false);
		expect(JSON.stringify(result)).not.toContain("hunter2");
	});

	it("fails on a closed port", async () => {
		await serve(() => "+PONG\r\n");
		const closed = port;
		await new Promise<void>((resolve) => server.close(() => resolve()));
		expect((await probeRedis(`redis://127.0.0.1:${closed}`)).ok).toBe(false);
		await serve(() => "+PONG\r\n");
	});
});

describe("setup api", () => {
	let directory: string;
	let store: ConfigStore;
	let saved: Record<string, string | undefined>;
	let admins: boolean;
	let caller: boolean;
	let probes: Probes;

	const context = (): SetupRequestContext => ({ isAdmin: async () => caller, adminExists: async () => admins, probes });
	const call = (method: string, path: string, body: unknown = {}) => handleSetupRequest(method, `/api/setup${path}`, body, context());

	beforeEach(() => {
		directory = mkdtempSync(join(tmpdir(), "flixer-setup-"));
		saved = Object.fromEntries(ENV.map((key) => [key, process.env[key]]));
		for (const key of ENV) {
			delete process.env[key];
		}
		store = new ConfigStore(directory);
		setAppConfig(new AppConfig(store));
		updateRuntime({ mode: "bootstrap", database: "unconfigured" });
		admins = false;
		caller = false;
		probes = {
			database: async () => ({ ok: true, hasUsers: false }),
			redis: async (url) => (url.includes("bad") ? { ok: false, message: "refused" } : { ok: true }),
			http: async () => ({ ok: true }),
		};
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

	it("ignores paths that are not setup routes", async () => {
		expect(await call("GET", "/status")).toBeNull();
		expect(await call("DELETE", "/progress")).toBeNull();
	});

	it("saves the database step on a fresh install and marks setup as started", async () => {
		const response = await call("POST", "/steps/database", { databaseUrl: "postgres://u:p@db:5432/flixer" });
		expect(response?.status).toBe(200);
		expect(store.get("databaseUrl")).toBe("postgres://u:p@db:5432/flixer");
		expect(store.setupState()).toBe("in_progress");
		expect(store.wizardProgress().completedSteps).toEqual(["database"]);
	});

	it("tests a step without saving it", async () => {
		const response = await call("POST", "/steps/redis/test", { redisUrl: "redis://bad:6379" });
		expect(response).toEqual({ status: 200, body: { ok: false, message: "refused" } });
		expect(store.has("redisUrl")).toBe(false);
		expect(store.setupState()).toBe("not_started");
	});

	it("returns field errors for invalid input and nothing is written", async () => {
		const response = await call("POST", "/steps/database", { databaseUrl: "mysql://x" });
		expect(response?.status).toBe(400);
		expect(response?.body).toHaveProperty("fields.databaseUrl");
		expect(store.has("databaseUrl")).toBe(false);
	});

	it("refuses to override a value that comes from the environment", async () => {
		process.env.REDIS_URL = "redis://env-redis:6379";
		const response = await call("POST", "/steps/redis", { redisUrl: "redis://other:6379" });
		expect(response?.status).toBe(409);
		expect(response?.body).toHaveProperty("fields.redisUrl");
		expect((await call("POST", "/steps/redis", { redisUrl: "redis://env-redis:6379" }))?.status).toBe(200);
	});

	it("generates secrets and never returns them", async () => {
		const response = await call("POST", "/steps/secrets", { generate: ["jwtSecret"] });
		expect(response?.status).toBe(200);
		expect(store.get("jwtSecret")).toBeTruthy();
		const progress = await call("GET", "/progress");
		expect(JSON.stringify(progress?.body)).not.toContain(store.get("jwtSecret") as string);
		expect(progress?.body).toHaveProperty("config.jwtSecret.set", true);
		expect((await call("POST", "/steps/secrets", {}))?.status).toBe(400);
	});

	it("does not return secret values in progress", async () => {
		store.setMany({ databaseUrl: "postgres://u:topsecret@db:5432/flixer" });
		expect(JSON.stringify((await call("GET", "/progress"))?.body)).not.toContain("topsecret");
	});

	it("locks setup once an administrator exists", async () => {
		updateRuntime({ mode: "ready", database: "ok" });
		admins = true;
		expect((await call("POST", "/steps/redis", { redisUrl: "redis://r:6379" }))?.status).toBe(403);
		caller = true;
		expect((await call("POST", "/steps/redis", { redisUrl: "redis://r:6379" }))?.status).toBe(200);
	});

	it("keeps setup open after pointing it at a database that already has accounts, and does not complete it", async () => {
		probes.database = async () => ({ ok: true, hasUsers: true });
		expect((await call("POST", "/steps/database", { databaseUrl: "postgres://u:p@db:5432/flixer" }))?.status).toBe(200);
		expect(store.wizardProgress().adoptedAccounts).toBe(true);
		adoptExistingUsers(true);
		expect(store.setupState()).toBe("in_progress");
		updateRuntime({ mode: "ready", database: "ok" });
		admins = true;
		expect((await call("POST", "/steps/redis", { redisUrl: "redis://r:6379" }))?.status).toBe(200);
	});

	it("locks setup after completion, including during a bootstrap outage", async () => {
		store.setSetupState("completed");
		expect((await call("POST", "/steps/redis", { redisUrl: "redis://r:6379" }))?.status).toBe(403);
		expect((await call("GET", "/progress"))?.status).toBe(403);
		expect(store.has("redisUrl")).toBe(false);
	});

	it("only completes when everything required is in place", async () => {
		expect((await call("POST", "/complete"))?.status).toBe(409);
		updateRuntime({ mode: "ready", database: "ok" });
		store.setMany({ databaseUrl: "postgres://u:p@db/flixer", redisUrl: "redis://r", publicUrl: "https://x.example.com" });
		expect((await call("POST", "/complete"))?.status).toBe(409);
		admins = true;
		caller = true;
		expect((await call("POST", "/complete"))?.status).toBe(200);
		expect(store.setupState()).toBe("completed");
	});

	it("resets only on explicit confirmation and by an administrator", async () => {
		updateRuntime({ mode: "ready", database: "ok" });
		admins = true;
		store.setSetupState("completed");
		store.setMany({ redisUrl: "redis://r" });
		expect((await call("POST", "/reset", { confirm: "RESET" }))?.status).toBe(403);
		caller = true;
		expect((await call("POST", "/reset", {}))?.status).toBe(400);
		expect((await call("POST", "/reset", { confirm: "RESET" }))?.status).toBe(200);
		expect(store.setupState()).toBe("not_started");
		expect(store.get("redisUrl")).toBe("redis://r");
	});

	it("rejects an unknown step and persists the chosen flow", async () => {
		expect((await call("POST", "/steps/nope", {}))?.status).toBe(404);
		expect((await call("POST", "/flow", { flow: "weird" }))?.status).toBe(400);
		await call("POST", "/flow", { flow: "advanced" });
		expect(store.wizardProgress().flow).toBe("advanced");
	});
});
