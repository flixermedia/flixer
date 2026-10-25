import { mkdtempSync, rmSync } from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppConfig, setAppConfig } from "../config/store/appConfig.js";
import { ConfigStore } from "../config/store/configStore.js";
import { startBootstrapServer, stopBootstrapServer } from "./bootstrapServer.js";
import { adoptEnvironmentInstall, adoptExistingUsers, setupStatus, updateRuntime } from "./setupStatus.js";
import { waitForDatabase } from "./waitForDatabase.js";

const SECRET = "s".repeat(40);
const ENV = ["DATABASE_URL", "JWT_SECRET", "APP_SECRET"];

describe("bootstrap", () => {
	let directory: string;
	let store: ConfigStore;
	let config: AppConfig;
	let saved: Record<string, string | undefined>;

	beforeEach(() => {
		directory = mkdtempSync(join(tmpdir(), "flixer-boot-"));
		saved = Object.fromEntries(ENV.map((key) => [key, process.env[key]]));
		for (const key of ENV) {
			delete process.env[key];
		}
		store = new ConfigStore(directory);
		config = new AppConfig(store);
		setAppConfig(config);
		updateRuntime({ mode: "bootstrap", database: "unconfigured" });
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

	it("reports a fresh install as not_started", () => {
		expect(setupStatus(config)).toEqual({ state: "not_started", mode: "bootstrap", database: "unconfigured", persistent: true });
	});

	it("never exposes configuration in the status", () => {
		store.setMany({ databaseUrl: "postgres://user:hunter2@db/flixer", appSecret: SECRET });
		expect(JSON.stringify(setupStatus(config))).not.toMatch(/hunter2|postgres|s{10}/);
	});

	it("keeps a completed setup completed when the configured database is unavailable", () => {
		store.setMany({ databaseUrl: "postgres://u:p@db:5432/flixer" });
		store.setSetupState("completed");
		updateRuntime({ database: "unavailable" });
		expect(setupStatus(config).state).toBe("completed");
	});

	it("asks for recovery when setup is completed but no database is configured", () => {
		store.setSetupState("completed");
		expect(setupStatus(config).state).toBe("recovery_required");
	});

	it("adopts an installation configured entirely through the environment", () => {
		process.env.DATABASE_URL = "postgres://db/flixer";
		process.env.JWT_SECRET = SECRET;
		adoptEnvironmentInstall(config);
		expect(store.setupState()).toBe("not_started");
		process.env.APP_SECRET = SECRET;
		adoptEnvironmentInstall(config);
		expect(store.setupState()).toBe("completed");
	});

	it("adopts an installation that already has users", () => {
		adoptExistingUsers(false, config);
		expect(store.setupState()).toBe("not_started");
		adoptExistingUsers(true, config);
		expect(store.setupState()).toBe("completed");
	});

	it("serves only status and version until the app is ready, and 503 otherwise", async () => {
		const server: Server = await startBootstrapServer(0);
		const port = (server.address() as { port: number }).port;
		try {
			const status = await fetch(`http://127.0.0.1:${port}/api/setup/status`);
			expect(status.status).toBe(200);
			expect((await status.json()).state).toBe("not_started");
			expect((await fetch(`http://127.0.0.1:${port}/api/version`)).status).toBe(200);
			const other = await fetch(`http://127.0.0.1:${port}/api/auth/login`, { method: "POST" });
			expect(other.status).toBe(503);
			expect(other.headers.get("retry-after")).toBe("5");
		} finally {
			await stopBootstrapServer(server);
		}
	});

	it("waits for the database, then continues and records it", async () => {
		let calls = 0;
		const probe = async () => (++calls < 2 ? ({ ok: false, reason: "unavailable", message: "refused" } as const) : ({ ok: true, hasUsers: true } as const));
		const logs: string[] = [];
		const waiting = waitForDatabase((message) => logs.push(message), probe);
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(setupStatus(config).database).toBe("unavailable");
		const { retryDatabaseNow } = await import("./waitForDatabase.js");
		retryDatabaseNow();
		await waiting;
		expect(setupStatus(config).database).toBe("ok");
		expect(store.setupState()).toBe("completed");
		expect(logs).toEqual(["Waiting for PostgreSQL: refused"]);
	});
});
