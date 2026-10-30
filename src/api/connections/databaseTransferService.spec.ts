import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AppConfig, setAppConfig } from "../../config/store/appConfig.js";
import { ConfigStore } from "../../config/store/configStore.js";
import { DatabaseTransferService, redactDatabaseUrl, replaceableSchemas } from "./databaseTransferService.js";

describe("DatabaseTransferService", () => {
	let directory: string | undefined;
	let store: ConfigStore | undefined;

	afterEach(() => {
		setAppConfig(undefined);
		store?.close();
		store = undefined;
		if (directory) rmSync(directory, { recursive: true, force: true });
		directory = undefined;
	});

	it("preserves schemas owned by managed PostgreSQL roles during replacement", () => {
		expect(
			replaceableSchemas(
				[
					{ name: "auth", owner: "supabase_admin" },
					{ name: "public", owner: "postgres" },
					{ name: "flixer_data", owner: "postgres" },
				],
				"postgres",
			),
		).toEqual(["flixer_data"]);
	});

	it("redacts URL and query-string passwords before exposing database addresses", () => {
		expect(redactDatabaseUrl("postgres://flixer:secret@db.example.com/flixer?password=other")).toBe(
			"postgres://flixer:%5Bredacted%5D@db.example.com/flixer?password=%5Bredacted%5D",
		);
		expect(redactDatabaseUrl(undefined)).toBeNull();
		expect(redactDatabaseUrl("not a database URL")).toBeNull();
	});

	function serviceFor(sourceUrl: string): DatabaseTransferService {
		directory = mkdtempSync(join(tmpdir(), "flixer-database-transfer-"));
		store = new ConfigStore(directory);
		store.setMany({ databaseUrl: sourceUrl });
		setAppConfig(new AppConfig(store));
		return new DatabaseTransferService();
	}

	it("returns the configured database URL with credentials redacted", () => {
		const service = serviceFor("postgres://flixer:secret@db.example.com/flixer?password=other");

		expect(service.status().currentDatabaseUrl).not.toContain("secret");
		expect(service.status().currentDatabaseUrl).not.toContain("other");
		expect(service.status().currentDatabaseUrl).toContain("%5Bredacted%5D");
	});

	it("starts idle without exposing a target URL", () => {
		const service = serviceFor("postgres://flixer:secret@source:5432/flixer");

		expect(service.status()).toEqual({
			state: "idle",
			phase: "",
			message: "",
			sourceLocked: false,
			startedAt: null,
			finishedAt: null,
			currentDatabaseUrl: redactDatabaseUrl(store?.get("databaseUrl")),
		});
	});

	it("rejects a transfer to the currently configured database", () => {
		const service = serviceFor("postgres://flixer:secret@postgres:5432/flixer");

		expect(() => service.start("postgres://other:password@postgres:5432/flixer")).toThrow(
			"The target must be a different PostgreSQL database.",
		);
		expect(service.status().state).toBe("idle");
	});

	it("rejects an invalid target URL before starting work", () => {
		const service = serviceFor("postgres://flixer:secret@source:5432/flixer");

		expect(() => service.start("https://database.example.com/flixer")).toThrow("Must start with postgres://");
		expect(service.status().state).toBe("idle");
	});
});
