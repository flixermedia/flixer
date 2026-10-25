import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppConfig, configDirectory } from "./appConfig.js";
import { ConfigStore, ConfigValidationError } from "./configStore.js";
import { SecretBox } from "./secretBox.js";

const SECRET = "a".repeat(40);
const ENV_KEYS = ["DATABASE_URL", "APP_SECRET", "INDEXER_URL", "INDEXER_INTERNAL_URL", "PASSKEY_RP_NAME", "APP_URL", "DATA_PATH"];

describe("config store", () => {
	let directory: string;
	let saved: Record<string, string | undefined>;

	beforeEach(() => {
		directory = mkdtempSync(join(tmpdir(), "flixer-config-"));
		saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
		for (const key of ENV_KEYS) {
			delete process.env[key];
		}
	});

	afterEach(() => {
		for (const key of ENV_KEYS) {
			if (saved[key] === undefined) {
				delete process.env[key];
			} else {
				process.env[key] = saved[key];
			}
		}
		rmSync(directory, { recursive: true, force: true });
	});

	it("persists values across restarts and encrypts secrets at rest", () => {
		const first = new ConfigStore(directory);
		first.setMany({ appSecret: SECRET, publicUrl: "https://flixer.example.com" });
		first.close();

		const second = new ConfigStore(directory);
		expect(second.get("appSecret")).toBe(SECRET);
		expect(second.get("publicUrl")).toBe("https://flixer.example.com");
		second.close();

		expect(readFileSync(join(directory, "flixer-config.db")).includes(SECRET)).toBe(false);
	});

	it("stores bootstrap config under DATA_PATH/config", () => {
		process.env.DATA_PATH = directory;
		expect(configDirectory()).toBe(join(directory, "config"));
	});

	it("keeps the encryption key private to its owner", () => {
		new ConfigStore(directory).close();
		expect(statSync(join(directory, "config.key")).mode & 0o777).toBe(0o600);
	});

	it("refuses a corrupted key instead of replacing it", () => {
		const keyPath = join(directory, "config.key");
		new SecretBox(keyPath);
		writeFileSync(keyPath, "not-a-valid-key");
		expect(() => new SecretBox(keyPath)).toThrow("corrupted");
	});

	it("rejects invalid values without writing any of them", () => {
		const store = new ConfigStore(directory);
		expect(() => store.setMany({ publicUrl: "https://ok.example.com", appSecret: "short" })).toThrow(ConfigValidationError);
		expect(store.has("publicUrl")).toBe(false);
		expect(store.version()).toBe(0);
		store.close();
	});

	it("bumps the version on every save", () => {
		const store = new ConfigStore(directory);
		expect(store.setMany({ publicUrl: "http://localhost:8080" })).toBe(1);
		expect(store.setMany({ appUrl: "http://localhost:8080" })).toBe(2);
		store.close();
	});

	it("never leaves a completed setup without an explicit reset", () => {
		const store = new ConfigStore(directory);
		expect(store.setupState()).toBe("not_started");
		store.setSetupState("in_progress");
		store.setSetupState("completed");
		expect(() => store.setSetupState("not_started")).toThrow();
		expect(store.setupState()).toBe("completed");
		store.reset();
		expect(store.setupState()).toBe("not_started");
		store.close();
	});

	describe("priority", () => {
		it("prefers the environment, then the store, then the default", () => {
			const store = new ConfigStore(directory);
			const config = new AppConfig(store);
			expect(config.get("passkeyRpName")).toBe("Flixer");
			expect(config.source("passkeyRpName")).toBe("default");

			store.setMany({ passkeyRpName: "Stored" });
			expect(config.get("passkeyRpName")).toBe("Stored");
			expect(config.source("passkeyRpName")).toBe("store");

			process.env.PASSKEY_RP_NAME = "From env";
			expect(config.get("passkeyRpName")).toBe("From env");
			expect(config.source("passkeyRpName")).toBe("env");
			store.close();
		});

		it("lets one environment variable override only its own key", () => {
			const store = new ConfigStore(directory);
			store.setMany({ databaseUrl: "postgres://stored/db", appUrl: "https://stored.example.com" });
			process.env.DATABASE_URL = "postgres://env/db";
			const config = new AppConfig(store);
			expect(config.get("databaseUrl")).toBe("postgres://env/db");
			expect(config.get("appUrl")).toBe("https://stored.example.com");
			store.close();
		});

		it("honours environment aliases and ignores blank values", () => {
			const config = new AppConfig(null);
			process.env.INDEXER_INTERNAL_URL = "http://alias:1";
			expect(config.get("indexerUrl")).toBe("http://alias:1");
			process.env.INDEXER_URL = "   ";
			expect(config.get("indexerUrl")).toBe("http://alias:1");
			process.env.INDEXER_URL = "http://primary:1";
			expect(config.get("indexerUrl")).toBe("http://primary:1");
		});

		it("works from the environment alone when no store can be opened", () => {
			const config = new AppConfig(null);
			expect(config.get("databaseUrl")).toBeUndefined();
			expect(() => config.require("databaseUrl")).toThrow("DATABASE_URL");
			process.env.APP_SECRET = SECRET;
			expect(config.require("appSecret")).toBe(SECRET);
		});
	});
});
