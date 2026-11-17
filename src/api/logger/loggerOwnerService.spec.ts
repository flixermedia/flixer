import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppConfig, setAppConfig } from "../../config/store/appConfig.js";
import { ConfigStore } from "../../config/store/configStore.js";
import { loggerExporter } from "../../logs/loggerExporter.js";
import { LoggerService } from "./loggerService.js";

describe("logger owner control plane", () => {
	let directory: string;
	let store: ConfigStore;
	const owner = "o".repeat(40);
	const manage = "m".repeat(40);
	const sample = {
		filesystem_total_bytes: 10000, filesystem_available_bytes: 8000, database_bytes: 200,
		compaction_debt_bytes: 50, compactions_in_progress: 1,
	};
	const requireAdmin = vi.fn(async (authorization?: string) => {
		if (authorization !== "admin") throw new Error("forbidden");
	});

	beforeEach(() => {
		directory = mkdtempSync(join(tmpdir(), "flixer-logger-owner-"));
		store = new ConfigStore(directory);
		store.setMany({ loggerUrl: "https://logger.example", loggerManageToken: manage });
		setAppConfig(new AppConfig(store));
	});

	afterEach(() => {
		loggerExporter.configure();
		setAppConfig(undefined);
		store.close();
		vi.unstubAllGlobals();
		rmSync(directory, { recursive: true, force: true });
	});

	it("requires an admin, verifies and encrypts the owner credential, and manages thresholds", async () => {
		const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
			expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${owner}`);
			return new Response(JSON.stringify(url.endsWith("/capacity")
				? sample : { max_database_bytes: 1000, min_free_bytes: 500 }), { status: 200 });
		});
		vi.stubGlobal("fetch", fetcher);
		const service = new LoggerService({ requireAdmin });
		await expect(service.configureOwner({ ownerToken: owner }, "bad")).rejects.toThrow("forbidden");
		expect(fetcher).not.toHaveBeenCalled();
		expect(await service.ownerConfiguration("admin")).toEqual({ configured: false });
		expect(await service.configureOwner({ ownerToken: owner }, "admin")).toEqual({ configured: true });
		expect(readFileSync(join(directory, "flixer-config.db")).includes(owner)).toBe(false);
		expect(await service.ownerConfiguration("admin")).toEqual({ configured: true });
		expect(await service.ownerCapacity("admin")).toEqual(sample);
		expect(await service.getCapacityPolicy("admin")).toEqual({ maxDatabaseBytes: 1000, minFreeBytes: 500 });
		expect(await service.setCapacityPolicy({ maxDatabaseBytes: 1000, minFreeBytes: 500 }, "admin"))
			.toEqual({ maxDatabaseBytes: 1000, minFreeBytes: 500 });
		expect(JSON.parse(String(fetcher.mock.calls.at(-1)?.[1]?.body))).toEqual({ max_database_bytes: 1000, min_free_bytes: 500 });
		await expect(service.setCapacityPolicy({ maxDatabaseBytes: -1, minFreeBytes: 0 }, "admin")).rejects.toThrow();
	});

	it("does not send owner credentials after the logger endpoint changes", async () => {
		store.setMany({ loggerOwnerUrl: "https://logger.example", loggerOwnerToken: owner, loggerUrl: "https://other.example" });
		const fetcher = vi.fn();
		vi.stubGlobal("fetch", fetcher);
		const service = new LoggerService({ requireAdmin });
		expect(await service.ownerConfiguration("admin")).toEqual({ configured: false });
		await expect(service.ownerCapacity("admin")).rejects.toThrow();
		expect(fetcher).not.toHaveBeenCalled();
	});

	it("does not save an invalid credential or one checked against a changed configuration", async () => {
		const service = new LoggerService({ requireAdmin });
		vi.stubGlobal("fetch", vi.fn(async () => new Response("denied", { status: 401 })));
		await expect(service.configureOwner({ ownerToken: owner }, "admin")).rejects.toThrow();
		expect(store.get("loggerOwnerToken")).toBeUndefined();
		vi.stubGlobal("fetch", vi.fn(async () => {
			store.setMany({ loggerManageToken: "n".repeat(40) });
			return new Response(JSON.stringify(sample), { status: 200 });
		}));
		await expect(service.configureOwner({ ownerToken: owner }, "admin")).rejects.toThrow("configuration changed");
		expect(store.get("loggerOwnerToken")).toBeUndefined();
	});
});
