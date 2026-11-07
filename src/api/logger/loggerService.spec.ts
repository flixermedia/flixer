import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppConfig, setAppConfig } from "../../config/store/appConfig.js";
import { ConfigStore } from "../../config/store/configStore.js";
import { LoggerService } from "./loggerService.js";
import { loggerExporter } from "../../logs/loggerExporter.js";

describe("logger control plane", () => {
	let directory: string;
	let store: ConfigStore;
	const manage = "m".repeat(40);
	const requireAdmin = vi.fn(async (authorization?: string) => {
		if (authorization !== "Bearer admin") throw new Error("forbidden");
	});

	beforeEach(() => {
		directory = mkdtempSync(join(tmpdir(), "flixer-logger-config-"));
		store = new ConfigStore(directory);
		setAppConfig(new AppConfig(store));
		requireAdmin.mockClear();
	});

	afterEach(() => {
		loggerExporter.configure();
		setAppConfig(undefined);
		store.close();
		vi.unstubAllGlobals();
		rmSync(directory, { recursive: true, force: true });
	});

	it("requires an admin, tests the logger, and stores the management credential encrypted", async () => {
		const ingest = "i".repeat(40);
		const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
			if (url.endsWith("/credentials")) {
				const body = JSON.parse(String(init?.body)) as { scope: string; expires_at: string; app?: string };
				expect(body.scope).toBe("ingest");
				expect(body.app).toBe("flixer");
				return new Response(JSON.stringify({ token: ingest, credential: { scope: body.scope, app: body.app, expires_at: body.expires_at } }), { status: 201 });
			}
			return new Response(JSON.stringify({ enabled: false, days: 0 }), { status: 200 });
		});
		vi.stubGlobal("fetch", fetcher);
		const service = new LoggerService({ requireAdmin });
		await expect(service.configure({ endpoint: "https://logger.example", manageToken: manage }, "bad")).rejects.toThrow("forbidden");
		expect(fetcher).not.toHaveBeenCalled();
		await expect(service.configure({ endpoint: "http://remote.example", manageToken: manage }, "Bearer admin")).rejects.toThrow();
		expect(fetcher).not.toHaveBeenCalled();
		await expect(service.configure({ endpoint: "https://logger.example", manageToken: manage }, "Bearer admin")).resolves.toEqual({
			configured: true,
			endpoint: "https://logger.example",
		});
		expect(store.get("loggerManageToken")).toBe(manage);
		expect(store.get("loggerIngestToken")).toBe(ingest);
		expect(readFileSync(join(directory, "flixer-config.db")).includes(manage)).toBe(false);
		expect(readFileSync(join(directory, "flixer-config.db")).includes(ingest)).toBe(false);
		expect(await service.configuration("Bearer admin")).toEqual({ configured: true, endpoint: "https://logger.example" });
		expect(fetcher.mock.calls).toHaveLength(2);
	});

	it("does not save inaccessible or invalid configurations", async () => {
		vi.stubGlobal("fetch", vi.fn(async () => new Response("no", { status: 401 })));
		const service = new LoggerService({ requireAdmin });
		await expect(service.configure({ endpoint: "https://logger.example", manageToken: manage }, "Bearer admin")).rejects.toThrow();
		expect(store.get("loggerManageToken")).toBeUndefined();
	});

	it("renews missing or expiring ingestion credentials, but leaves healthy credentials unchanged", async () => {
		store.setMany({ loggerUrl: "https://logger.example", loggerManageToken: manage });
		const ingest = "i".repeat(40);
		const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
			const body = JSON.parse(String(init.body)) as { scope: string; expires_at: string; app?: string };
			expect(body.app).toBe("flixer");
			return new Response(JSON.stringify({ token: ingest, credential: { scope: body.scope, app: body.app, expires_at: body.expires_at } }), { status: 201 });
		});
		vi.stubGlobal("fetch", fetcher);
		const service = new LoggerService({ requireAdmin });
		await service.renewIngestCredential();
		expect(store.get("loggerIngestToken")).toBe(ingest);
		expect(Date.parse(store.get("loggerIngestExpiry") ?? "")).toBeGreaterThan(Date.now() + 300 * 86_400_000);
		await service.renewIngestCredential();
		expect(fetcher).toHaveBeenCalledOnce();
		loggerExporter.enqueue({
			time: new Date().toISOString(), level: "info", app: "flixer", source: "test", message: "pending",
		});
		expect(loggerExporter.status().queued).toBe(1);
		store.setMany({ loggerIngestExpiry: new Date(Date.now() + 86_400_000).toISOString() });
		await service.renewIngestCredential();
		expect(fetcher).toHaveBeenCalledTimes(2);
		expect(loggerExporter.status().queued).toBe(1);
		store.setMany({ loggerIngestApp: "" });
		await service.renewIngestCredential();
		expect(fetcher).toHaveBeenCalledTimes(3);
		expect(store.get("loggerIngestApp")).toBe("flixer");
	});

	it.each([undefined, "flixer-indexer"])("preserves the legacy credential when renewal returns binding %s", async (app) => {
		const oldToken = "o".repeat(40);
		const oldExpiry = new Date(Date.now() + 30 * 86_400_000).toISOString();
		store.setMany({
			loggerUrl: "https://logger.example",
			loggerManageToken: manage,
			loggerIngestToken: oldToken,
			loggerIngestExpiry: oldExpiry,
		});

		const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
			const body = JSON.parse(String(init.body)) as { scope: string; expires_at: string };
			return new Response(JSON.stringify({
				token: "n".repeat(40),
				credential: { scope: body.scope, app, expires_at: body.expires_at },
			}), { status: 201 });
		});
		vi.stubGlobal("fetch", fetcher);
		const service = new LoggerService({ requireAdmin: async () => undefined });
		service.restoreExporter();
		await expect(service.renewIngestCredential()).rejects.toThrow();
		expect(store.get("loggerIngestToken")).toBe(oldToken);
		expect(store.get("loggerIngestExpiry")).toBe(oldExpiry);
		expect(store.get("loggerIngestApp")).not.toBe("flixer");
		expect(loggerExporter.status().enabled).toBe(true);
	});

	it("does not restore an API credential revoked while renewal is in flight", async () => {
		const id = "a".repeat(32);
		store.setMany({
			loggerUrl: "https://logger.example", loggerManageToken: manage,
			loggerIngestToken: "o".repeat(40), loggerIngestId: id, loggerIngestApp: "flixer",
			loggerIngestExpiry: new Date(Date.now() + 60_000).toISOString(),
		});
		let entered!: () => void;
		let release!: () => void;
		const started = new Promise<void>((resolve) => { entered = resolve; });
		const blocked = new Promise<void>((resolve) => { release = resolve; });
		vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
			if (init?.method === "DELETE") return new Response(null, { status: 204 });
			entered();
			await blocked;
			const body = JSON.parse(String(init?.body)) as { expires_at: string };
			return new Response(JSON.stringify({ token: "n".repeat(40), credential: {
				id, scope: "ingest", app: "flixer", expires_at: body.expires_at,
			} }), { status: 201 });
		}));
		const service = new LoggerService({ requireAdmin: async () => {} });
		service.restoreExporter();
		const renewing = service.renewIngestCredential();
		await started;
		await service.revokeCredential(id);
		expect(loggerExporter.status().enabled).toBe(false);
		release();
		await expect(renewing).rejects.toThrow("configuration changed");
		expect(store.get("loggerIngestToken")).toBeUndefined();
	});

	it("manages retention and brokers short-lived query tokens without exposing its management token", async () => {
		store.setMany({ loggerUrl: "https://logger.example", loggerManageToken: manage });
		const queryToken = "q".repeat(40);
		const fetcher = vi.fn(async (url: string, init: RequestInit) => {
			expect(init.redirect).toBe("error");
			expect(new Headers(init.headers).get("authorization")).toBe(`Bearer ${manage}`);
			if (url.endsWith("/credentials")) {
				const body = JSON.parse(String(init.body)) as { scope: string; expires_at: string };
				expect(body.scope).toBe("query");
				expect(Date.parse(body.expires_at) - Date.now()).toBeLessThanOrEqual(60_000);
				return new Response(JSON.stringify({ token: queryToken, credential: { scope: "query", expires_at: body.expires_at } }), { status: 201 });
			}
			return new Response(JSON.stringify({ enabled: true, days: 14 }), { status: 200 });
		});

		vi.stubGlobal("fetch", fetcher);
		const service = new LoggerService({ requireAdmin });
		expect(await service.setRetention({ enabled: true, days: 14 }, "Bearer admin")).toEqual({ enabled: true, days: 14 });
		const response = await service.issueQueryToken("Bearer admin");
		expect(response.token).toBe(queryToken);
		expect(JSON.stringify(response)).not.toContain(manage);
		expect(response.endpoint).toBe("https://logger.example");
		await expect(service.setRetention({ enabled: true, days: 0 }, "Bearer admin")).rejects.toThrow();
	});


	it("validates and mediates severity-specific retention without exposing other deployments", async () => {
		store.setMany({ loggerUrl: "https://logger.example", loggerManageToken: manage });
		const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
			expect(JSON.parse(String(init.body))).toEqual({ enabled: true, days: 14, severity_days: { error: 30, trace: 1 } });
			return new Response(JSON.stringify({ enabled: true, days: 14, severity_days: { error: 30, trace: 1 } }));
		});
		vi.stubGlobal("fetch", fetcher);
		const service = new LoggerService({ requireAdmin: async () => {} });
		expect(await service.setRetention({ enabled: true, days: 14, severityDays: { error: 30, trace: 1 } }, "******")).toEqual({
			enabled: true, days: 14, severityDays: { error: 30, trace: 1 },
		});
		await expect(service.setRetention({ enabled: true, days: 14, severityDays: { error: 0 } }, "******")).rejects.toThrow();
		expect(fetcher).toHaveBeenCalledOnce();
	});

	it("requires an admin and verifies logger readiness", async () => {
		store.setMany({ loggerUrl: "https://logger.example", loggerManageToken: manage });
		const fetcher = vi.fn(async () => new Response(JSON.stringify({ status: "ready" })));
		vi.stubGlobal("fetch", fetcher);
		const service = new LoggerService({ requireAdmin: async (authorization) => {
			if (authorization !== "admin") throw new Error("forbidden");
		} });
		await expect(service.health("bad")).rejects.toThrow("forbidden");
		expect(fetcher).not.toHaveBeenCalled();
		expect(await service.health("admin")).toMatchObject({ status: "ready", exporter: { enabled: false, queued: 0 } });
		expect(fetcher.mock.calls).toHaveLength(1);
		fetcher.mockResolvedValueOnce(new Response("unavailable", { status: 503 }));
		expect(await service.health("admin")).toMatchObject({ status: "unavailable", exporter: { dropped: expect.any(Number) } });
	});

	it("validates and mediates per-deployment ingestion limits", async () => {
		store.setMany({ loggerUrl: "https://logger.example", loggerManageToken: manage });
		const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
			if (init.method === "PUT") {
				expect(JSON.parse(String(init.body))).toEqual({ events_per_second: 1500, burst: 4000 });
			}
			return new Response(JSON.stringify({ events_per_second: 1500, burst: 4000 }));
		});
		vi.stubGlobal("fetch", fetcher);
		const service = new LoggerService({ requireAdmin: async (authorization) => {
			if (authorization !== "admin") throw new Error("forbidden");
		} });
		await expect(service.getIngestionPolicy("bad")).rejects.toThrow("forbidden");
		expect(await service.getIngestionPolicy("admin")).toEqual({ eventsPerSecond: 1500, burst: 4000 });
		expect(await service.setIngestionPolicy({ eventsPerSecond: 1500, burst: 4000 }, "admin")).toEqual({ eventsPerSecond: 1500, burst: 4000 });
		await expect(service.setIngestionPolicy({ eventsPerSecond: 0, burst: 1 }, "admin")).rejects.toThrow();
		expect(fetcher).toHaveBeenCalledTimes(2);
		const expected = { eventsPerSecond: 1500, burst: 4000, credentialEventsPerSecond: 10, credentialBurst: 1000, serviceEventsPerSecond: 20, serviceBurst: 1000 };
		fetcher.mockResolvedValueOnce(new Response(JSON.stringify({
			events_per_second: 1500, burst: 4000, credential_events_per_second: 10, credential_burst: 1000, service_events_per_second: 20, service_burst: 1000,
		})));
		expect(await service.setIngestionPolicy(expected, "admin")).toEqual(expected);
		expect(JSON.parse(String(fetcher.mock.calls[2][1].body))).toEqual({
			events_per_second: 1500, burst: 4000, credential_events_per_second: 10, credential_burst: 1000, service_events_per_second: 20, service_burst: 1000,
		});
		await expect(service.setIngestionPolicy({ eventsPerSecond: 1500, burst: 4000, credentialEventsPerSecond: 10 }, "admin")).rejects.toThrow();
		await expect(service.setIngestionPolicy({ eventsPerSecond: 1500, burst: 4000, serviceBurst: 1000 }, "admin")).rejects.toThrow();
		fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ events_per_second: 1500, burst: 4000, credential_burst: 1000 })));
		await expect(service.getIngestionPolicy("admin")).rejects.toThrow("invalid ingestion policy");
	});

	it("restricts and validates deployment quota management", async () => {
		store.setMany({ loggerUrl: "https://logger.example", loggerManageToken: manage });
		const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
			if (init.method === "PUT") expect(JSON.parse(String(init.body))).toEqual({ max_bytes: 4096 });
			return new Response(JSON.stringify({ max_bytes: 4096, used_bytes: 1200 }));
		});
		vi.stubGlobal("fetch", fetcher);
		const service = new LoggerService({ requireAdmin: async (authorization) => {
			if (authorization !== "admin") throw new Error("forbidden");
		} });
		await expect(service.getQuota("bad")).rejects.toThrow("forbidden");
		await expect(service.setQuota({ maxBytes: -1 }, "admin")).rejects.toThrow();
		await expect(service.setQuota({ maxBytes: 2 ** 50 + 1 }, "admin")).rejects.toThrow();
		await expect(service.setQuota({ maxBytes: 1.5 }, "admin")).rejects.toThrow();
		expect(await service.getQuota("admin")).toEqual({ maxBytes: 4096, usedBytes: 1200 });
		expect(await service.setQuota({ maxBytes: 4096 }, "admin")).toEqual({ maxBytes: 4096, usedBytes: 1200 });
		fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ max_bytes: 1, used_bytes: -1 })));
		await expect(service.getQuota("admin")).rejects.toThrow("invalid quota");
		expect(fetcher).toHaveBeenCalledTimes(3);
	});

	it("requires an admin and validates deployment status", async () => {
		store.setMany({ loggerUrl: "https://logger.example", loggerManageToken: manage });
		const payload = {
			status: "ready", last_ingested_at: null, live_subscribers: 1,
			active_ingestions: 0, active_queries: 0, max_ingestions: 4, max_queries: 4,
		};
		const fetcher = vi.fn(async () => new Response(JSON.stringify(payload)));
		vi.stubGlobal("fetch", fetcher);
		const service = new LoggerService({ requireAdmin: async (authorization) => {
			if (authorization !== "admin") throw new Error("forbidden");
		} });
		await expect(service.status("bad")).rejects.toThrow("forbidden");
		expect(fetcher).not.toHaveBeenCalled();
		await expect(service.status("admin")).resolves.toEqual({ ...payload, retention: null });
		const retention = { completed_at: new Date().toISOString(), deleted: 500, batch_full: true, failed: false };
		fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ ...payload, retention })));
		await expect(service.status("admin")).resolves.toEqual({ ...payload, retention });
		fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ ...payload, retention: { ...retention, deleted: -1 } })));
		await expect(service.status("admin")).rejects.toThrow("invalid retention status");
		fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ ...payload, active_queries: -1 })));
		await expect(service.status("admin")).rejects.toThrow("invalid status");
	});

	it("lists and revokes deployment credentials without returning secrets", async () => {
		store.setMany({ loggerUrl: "https://logger.example", loggerManageToken: manage });
		const id = "a".repeat(32);
		const fetcher = vi.fn(async (_url: string, init: RequestInit) => init.method === "DELETE"
			? new Response(null, { status: 204 })
			: new Response(JSON.stringify({ credentials: [{ id, scope: "ingest", expires_at: "2099-01-01T00:00:00Z", token: "must-not-return" }] })));
		vi.stubGlobal("fetch", fetcher);
		const service = new LoggerService({ requireAdmin: async (authorization) => {
			if (authorization !== "admin") throw new Error("forbidden");
		} });
		await expect(service.listCredentials("bad")).rejects.toThrow("forbidden");
		expect(fetcher).not.toHaveBeenCalled();
		expect(await service.listCredentials("admin")).toEqual([{ id, scope: "ingest", expiresAt: "2099-01-01T00:00:00Z" }]);
		fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ credentials: [
			{ id, scope: "ingest", app: "flixer", expires_at: "2099-01-01T00:00:00Z", token: "must-not-return" },
		] })));
		expect(await service.listCredentials("admin")).toEqual([{ id, scope: "ingest", app: "flixer", expiresAt: "2099-01-01T00:00:00Z" }]);
		fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ credentials: [
			{ id, scope: "query", app: "flixer", expires_at: "2099-01-01T00:00:00Z" },
		] })));
		await expect(service.listCredentials("admin")).rejects.toThrow("invalid credentials");
		await expect(service.revokeCredential("../other", "admin")).rejects.toThrow("Invalid");
		expect(await service.revokeCredential(id, "admin")).toEqual({ revoked: true });
		expect(fetcher.mock.calls[3][0]).toBe(`https://logger.example/api/logger/credentials/${id}`);
		fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ credentials: [{ id: "invalid" }] })));
		await expect(service.listCredentials("admin")).rejects.toThrow("invalid credentials");
	});
});
