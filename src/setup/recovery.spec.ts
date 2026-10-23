import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupStatus, updateRuntime } from "../bootstrap/setupStatus.js";
import { AppConfig, setAppConfig } from "../config/store/appConfig.js";
import { ConfigStore } from "../config/store/configStore.js";
import { announceRecovery, logRecoveryKey, needsRecovery, recoveryCode, resetRecoveryForTests } from "./recovery.js";
import { handleSetupRequest } from "./setupApi.js";
import type { Probes } from "./setupSteps.js";

const ENV = ["DATABASE_URL", "JWT_SECRET", "STREAM_TOKEN_SECRET", "REDIS_URL"];

describe("setup recovery", () => {
	let directory: string;
	let store: ConfigStore;
	let saved: Record<string, string | undefined>;
	const probes: Probes = { database: async () => ({ ok: true, hasUsers: true }), redis: async () => ({ ok: true }), http: async () => ({ ok: true }) };

	const call = (method: string, path: string, body: unknown = {}, code?: string) =>
		handleSetupRequest(method, `/api/setup${path}`, body, { isAdmin: async () => false, adminExists: async () => false, recoveryCode: code, probes });

	beforeEach(() => {
		directory = mkdtempSync(join(tmpdir(), "flixer-recovery-"));
		saved = Object.fromEntries(ENV.map((key) => [key, process.env[key]]));
		for (const key of ENV) {
			delete process.env[key];
		}
		store = new ConfigStore(directory);
		setAppConfig(new AppConfig(store));
		updateRuntime({ mode: "bootstrap", database: "unconfigured" });
		resetRecoveryForTests();
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

	it("is only needed when setup is completed, the server is not ready and no database is configured", () => {
		expect(needsRecovery()).toBe(false);
		store.setSetupState("completed");
		expect(needsRecovery()).toBe(true);
		expect(setupStatus().state).toBe("recovery_required");
		store.setMany({ databaseUrl: "postgres://u:p@db:5432/flixer" });
		expect(needsRecovery()).toBe(false);
		expect(setupStatus().state).toBe("completed");
		updateRuntime({ mode: "ready", database: "ok" });
		store.reset();
		store.setSetupState("completed");
		expect(needsRecovery()).toBe(false);
	});

	it("prints the code only when recovery is needed", () => {
		const lines: string[] = [];
		expect(announceRecovery((line) => lines.push(line))).toBe(false);
		store.setSetupState("completed");
		expect(announceRecovery((line) => lines.push(line))).toBe(true);
		expect(lines[0]).toContain(recoveryCode());
		expect(recoveryCode()).toMatch(/^([A-Z2-9]{4}-){3}[A-Z2-9]{4}$/);
	});

	it("refuses every setup route without the code, including progress", async () => {
		store.setSetupState("completed");
		for (const [method, path] of [["GET", "/progress"], ["POST", "/steps/database"], ["POST", "/steps/database/test"]]) {
			expect((await call(method, path, { databaseUrl: "postgres://u:p@db:5432/flixer" }))?.status).toBe(403);
			expect((await call(method, path, { databaseUrl: "postgres://u:p@db:5432/flixer" }, "AAAA-AAAA-AAAA-AAAA"))?.status).toBe(403);
		}
		expect(store.has("databaseUrl")).toBe(false);
	});

	it("lets the right code reconnect the database, and nothing else", async () => {
		store.setSetupState("completed");
		const code = recoveryCode();
		expect((await call("GET", "/progress", {}, code))?.body).toHaveProperty("state", "recovery_required");
		for (const path of ["/steps/redis", "/steps/admin", "/steps/secrets", "/flow", "/complete", "/reset"]) {
			expect((await call("POST", path, { confirm: "RESET", flow: "quick" }, code))?.status).toBe(403);
		}
		expect((await call("POST", "/steps/database/test", { databaseUrl: "postgres://u:p@db:5432/flixer" }, code.toLowerCase()))?.status).toBe(200);
		expect((await call("POST", "/steps/database", { databaseUrl: "postgres://u:p@db:5432/flixer" }, code))?.status).toBe(200);
		expect(store.get("databaseUrl")).toBe("postgres://u:p@db:5432/flixer");
		expect(store.setupState()).toBe("completed");
	});

	it("locks the code out after repeated wrong guesses", async () => {
		store.setSetupState("completed");
		for (let attempt = 0; attempt < 10; attempt += 1) {
			expect((await call("GET", "/progress", {}, "WRONG"))?.status).toBe(403);
		}
		expect((await call("GET", "/progress", {}, "WRONG"))?.status).toBe(429);
		expect((await call("GET", "/progress", {}, recoveryCode()))?.status).toBe(429);
	});

	describe("recovery key for a locked wizard", () => {
		beforeEach(() => {
			updateRuntime({ mode: "ready", database: "ok" });
			store.setSetupState("in_progress");
		});
		const locked = (method: string, path: string, code?: string) =>
			handleSetupRequest(method, `/api/setup${path}`, {}, { isAdmin: async () => false, adminExists: async () => true, recoveryCode: code, probes });

		it("keeps setup locked without a key and accepts only the right one", async () => {
			expect((await locked("GET", "/progress"))?.status).toBe(403);
			expect((await locked("GET", "/progress", "AAAA-AAAA-AAAA-AAAA"))?.status).toBe(403);
			expect((await locked("GET", "/progress", recoveryCode()))?.status).toBe(200);
		});

		it("never lets the key reopen a finished setup from scratch", async () => {
			expect((await locked("POST", "/reset", recoveryCode()))?.status).toBe(403);
		});

		it("writes the key to the log on request, at most once in a short while", async () => {
			const lines: string[] = [];
			expect(logRecoveryKey((line) => lines.push(line), 1_000_000)).toBe(true);
			expect(logRecoveryKey((line) => lines.push(line), 1_000_100)).toBe(false);
			expect(lines).toHaveLength(1);
			expect(lines[0]).toContain(recoveryCode());
		});

		it("answers the public request route without credentials", async () => {
			expect((await locked("POST", "/recovery/request"))?.status).toBe(200);
		});
	});
});
