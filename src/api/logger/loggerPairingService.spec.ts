import { createHash } from "node:crypto";
import { chmodSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppConfig, setAppConfig } from "../../config/store/appConfig.js";
import { ConfigStore } from "../../config/store/configStore.js";
import { loggerExporter } from "../../logs/loggerExporter.js";
import { LoggerService } from "./loggerService.js";

describe("logger pairing control plane", () => {
	let directory: string;
	let store: ConfigStore;
	const pairingToken = "p".repeat(43);
	const manage = "m".repeat(43);
	const requireAdmin = vi.fn(async (authorization?: string) => {
		if (authorization !== "admin") throw new Error("forbidden");
	});

	beforeEach(() => {
		directory = mkdtempSync(join(tmpdir(), "flixer-pairing-"));
		store = new ConfigStore(directory);
		setAppConfig(new AppConfig(store));
	});

	afterEach(() => {
		loggerExporter.configure();
		setAppConfig(undefined);
		store.close();
		vi.unstubAllGlobals();
		vi.unstubAllEnvs();
		rmSync(directory, { recursive: true, force: true });
	});

	it("reports manual, configured local, and unavailable local renewal separately", async () => {
		const service = new LoggerService({ requireAdmin });
		store.setMany({
			loggerUrl: "http://127.0.0.1:8098", loggerManageToken: manage,
			loggerManageExpiry: "2099-01-01T00:00:00.000Z",
		});
		vi.stubEnv("FLIXER_LOGGER_LOCAL_OWNER_FILE", "/private/owner");
		vi.stubEnv("FLIXER_LOGGER_LOCAL_ENDPOINT", "");
		expect((await service.configuration("admin")).managementRenewal).toBe("manual");
		store.setMany({ loggerLocalManaged: "true" });
		expect((await service.configuration("admin")).managementRenewal).toBe("automatic");
		vi.stubEnv("FLIXER_LOGGER_LOCAL_OWNER_FILE", "");
		expect((await service.configuration("admin")).managementRenewal).toBe("unavailable");
		vi.stubEnv("FLIXER_LOGGER_LOCAL_OWNER_FILE", "/private/owner");
		vi.stubEnv("FLIXER_LOGGER_LOCAL_ENDPOINT", "https://other.example");
		expect((await service.configuration("admin")).managementRenewal).toBe("unavailable");
		vi.stubEnv("FLIXER_LOGGER_LOCAL_ENDPOINT", "not a URL");
		expect((await service.configuration("admin")).managementRenewal).toBe("unavailable");
		vi.stubEnv("FLIXER_LOGGER_LOCAL_ENDPOINT", "http://other.example");
		expect((await service.configuration("admin")).managementRenewal).toBe("unavailable");
	});

	it("persists a redeemed credential encrypted when setup fails and retries without redeeming again", async () => {
		let failRetention = true;
		const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
			if (url.endsWith("/pairings/redeem")) {
				expect(new Headers(init?.headers).has("authorization")).toBe(false);
				expect(JSON.parse(String(init?.body))).toEqual({ token: pairingToken });
				return new Response(JSON.stringify({
					deployment_id: "tenant", token: manage,
					credential: { scope: "manage", expires_at: new Date(Date.now() + 86_400_000).toISOString() },
				}), { status: 201 });
			}
			expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${manage}`);
			if (url.endsWith("/retention")) {
				return failRetention ? new Response("", { status: 503 }) : new Response(JSON.stringify({ enabled: false, days: 0 }));
			}
			const body = JSON.parse(String(init?.body)) as { expires_at: string };
			return new Response(JSON.stringify({ token: "i".repeat(43), credential: { scope: "ingest", app: "flixer", expires_at: body.expires_at } }), { status: 201 });
		});
		vi.stubGlobal("fetch", fetcher);
		const service = new LoggerService({ requireAdmin });
		const request = { endpoint: "https://logger.example", deploymentId: "tenant", pairingToken };
		await expect(service.pair(request, "bad")).rejects.toThrow("forbidden");
		expect(fetcher).not.toHaveBeenCalled();
		await expect(service.pair(request, "admin")).rejects.toThrow();
		expect(await service.pairingStatus("admin")).toEqual({ pending: true, endpoint: "https://logger.example" });
		expect(store.get("loggerUrl")).toBeUndefined();
		expect(readFileSync(join(directory, "flixer-config.db")).includes(manage)).toBe(false);
		store.close();
		store = new ConfigStore(directory);
		setAppConfig(new AppConfig(store));
		expect(await service.pairingStatus("admin")).toEqual({ pending: true, endpoint: "https://logger.example" });
		await expect(service.pair(request, "admin")).rejects.toThrow("already pending");
		failRetention = false;
		expect(await service.retryPairing("admin")).toMatchObject({ configured: true, endpoint: "https://logger.example", managementExpiresAt: expect.any(String) });
		expect(await service.pairingStatus("admin")).toEqual({ pending: false, endpoint: null });
		expect(store.get("loggerManageToken")).toBe(manage);
		expect((await service.configuration("admin")).managementExpiresAt).toBe(store.get("loggerManageExpiry"));
		expect(store.get("loggerIngestApp")).toBe("flixer");
		expect(store.get("loggerPendingPairingToken")).toBeUndefined();
		expect(fetcher.mock.calls.filter(([url]) => url.endsWith("/pairings/redeem"))).toHaveLength(1);
	});

	it("clears the stored pairing expiry and pending secret on manual replacement", async () => {
		store.setMany({
			loggerUrl: "https://old.example", loggerManageToken: manage,
			loggerAiIngestToken: "a".repeat(43), loggerAiIngestExpiry: new Date(Date.now() + 60_000).toISOString(),
			loggerIndexerIngestToken: "b".repeat(43), loggerIndexerIngestExpiry: new Date(Date.now() + 60_000).toISOString(),
			loggerStreamerIngestToken: "c".repeat(43), loggerStreamerIngestExpiry: new Date(Date.now() + 60_000).toISOString(),
			loggerUpdaterIngestToken: "d".repeat(43), loggerUpdaterIngestExpiry: new Date(Date.now() + 60_000).toISOString(),
			loggerManageExpiry: new Date(Date.now() + 60_000).toISOString(),
			loggerLocalManaged: "true",
			loggerPendingPairingUrl: "https://old.example", loggerPendingPairingToken: manage,
			loggerPendingPairingExpiry: new Date(Date.now() + 60_000).toISOString(),
		});
		vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
			if (url.endsWith("/retention")) return new Response(JSON.stringify({ enabled: false, days: 0 }));
			const body = JSON.parse(String(init?.body)) as { expires_at: string };
			return new Response(JSON.stringify({ token: "i".repeat(43), credential: { scope: "ingest", app: "flixer", expires_at: body.expires_at } }), { status: 201 });
		}));
		const service = new LoggerService({ requireAdmin });
		await service.configure({ endpoint: "https://logger.example", manageToken: manage }, "admin");
		expect(await service.configuration("admin")).toEqual({ configured: true, endpoint: "https://logger.example" });
		expect(store.get("loggerPendingPairingToken")).toBeUndefined();
		expect(store.get("loggerAiIngestToken")).toBeUndefined();
		expect(store.get("loggerIndexerIngestToken")).toBeUndefined();
		expect(store.get("loggerStreamerIngestToken")).toBeUndefined();
		expect(store.get("loggerUpdaterIngestToken")).toBeUndefined();
		expect(store.get("loggerLocalManaged")).toBeUndefined();
	});

	it("coalesces AI enrollment, stores the app-bound credential encrypted, and reuses it", async () => {
		store.setMany({ loggerUrl: "https://logger.example", loggerManageToken: manage });
		const aiToken = "a".repeat(43);
		const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
			const body = JSON.parse(String(init?.body)) as { app: string; scope: string; expires_at: string };
			expect(body).toMatchObject({ app: "flixer-ai", scope: "ingest" });
			return new Response(JSON.stringify({ token: aiToken, credential: { scope: "ingest", app: body.app, expires_at: body.expires_at } }), { status: 201 });
		});
		vi.stubGlobal("fetch", fetcher);
		const service = new LoggerService({ requireAdmin });
		const [first, second] = await Promise.all([service.producerIngestConfiguration("flixer-ai"), service.producerIngestConfiguration("flixer-ai")]);
		expect(first).toEqual(second);
		expect(first).toMatchObject({ endpoint: "https://logger.example", token: aiToken });
		expect(await service.producerIngestConfiguration("flixer-ai")).toEqual(first);
		expect(fetcher).toHaveBeenCalledTimes(1);
		expect(readFileSync(join(directory, "flixer-config.db")).includes(aiToken)).toBe(false);
	});

	it("does not save an AI credential after logger configuration changes during issuance", async () => {
		store.setMany({ loggerUrl: "https://old.example", loggerManageToken: manage });
		let release!: () => void;
		let started!: () => void;
		const blocked = new Promise<void>((resolve) => { release = resolve; });
		const entered = new Promise<void>((resolve) => { started = resolve; });
		vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
			started();
			await blocked;
			const body = JSON.parse(String(init?.body)) as { expires_at: string };
			return new Response(JSON.stringify({ token: "a".repeat(43), credential: { scope: "ingest", app: "flixer-ai", expires_at: body.expires_at } }), { status: 201 });
		}));
		const service = new LoggerService({ requireAdmin });
		const pending = service.producerIngestConfiguration("flixer-ai");
		await entered;
		store.setMany({ loggerUrl: "https://new.example" });
		release();
		await expect(pending).rejects.toThrow("configuration changed");
		expect(store.get("loggerAiIngestToken")).toBeUndefined();
	});

	it("does not persist a producer credential revoked while issuance is in flight", async () => {
		store.setMany({ loggerUrl: "https://logger.example", loggerManageToken: manage });
		let release!: () => void;
		let entered!: () => void;
		const blocked = new Promise<void>((resolve) => { release = resolve; });
		const started = new Promise<void>((resolve) => { entered = resolve; });
		const id = "a".repeat(32);
		vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
			if (init?.method === "DELETE") return new Response(null, { status: 204 });
			entered();
			await blocked;
			const body = JSON.parse(String(init?.body)) as { expires_at: string };
			return new Response(JSON.stringify({ token: "b".repeat(43), credential: {
				id, scope: "ingest", app: "flixer-ai", expires_at: body.expires_at,
			} }), { status: 201 });
		}));
		const service = new LoggerService({ requireAdmin });
		const pending = service.producerIngestConfiguration("flixer-ai");
		await started;
		await service.revokeCredential(id, "admin");
		release();
		await expect(pending).rejects.toThrow("configuration changed");
		expect(store.get("loggerAiIngestToken")).toBeUndefined();
		expect(store.get("loggerAiIngestId")).toBeUndefined();
	});

	it("resumes a failed local bootstrap without issuing another management credential", async () => {
		const ownerPath = join(directory, "owner");
		writeFileSync(ownerPath, "o".repeat(43), { mode: 0o600 });
		let fail = true;
		const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
			if (url.endsWith("/owner/credentials")) {
				const body = JSON.parse(String(init?.body)) as { expires_at: string };
				return new Response(JSON.stringify({ token: manage, credential: { scope: "manage", expires_at: body.expires_at } }), { status: 201 });
			}
			if (url.endsWith("/retention")) {
				return fail ? new Response("", { status: 503 }) : new Response(JSON.stringify({ enabled: false, days: 0 }));
			}
			const body = JSON.parse(String(init?.body)) as { expires_at: string };
			return new Response(JSON.stringify({ token: "i".repeat(43), credential: { scope: "ingest", app: "flixer", expires_at: body.expires_at } }), { status: 201 });
		});
		vi.stubGlobal("fetch", fetcher);
		const service = new LoggerService({ requireAdmin });
		await expect(service.bootstrapLocal(ownerPath, "http://127.0.0.1:8098")).rejects.toThrow();
		expect(store.get("loggerLocalPending")).toBe("true");
		expect(store.get("loggerPendingPairingToken")).toBe(manage);
		expect(readFileSync(join(directory, "flixer-config.db")).includes(manage)).toBe(false);
		fail = false;
		expect(await service.bootstrapLocal("/missing/file", "http://127.0.0.1:8098")).toBe(true);
		expect(store.get("loggerUrl")).toBe("http://127.0.0.1:8098");
		expect(store.get("loggerLocalPending")).toBeUndefined();
		expect(store.get("loggerLocalManaged")).toBe("true");
		expect(fetcher.mock.calls.filter(([url]) => url.endsWith("/owner/credentials"))).toHaveLength(1);
	});

	it("replaces an expired pending local bootstrap for the same deployment", async () => {
		const ownerPath = join(directory, "owner");
		writeFileSync(ownerPath, "o".repeat(43), { mode: 0o600 });
		const endpoint = "http://127.0.0.1:8098";
		store.setMany({
			loggerLocalDeploymentId: "coder-test", loggerLocalPending: "true",
			loggerPendingPairingUrl: endpoint, loggerPendingPairingToken: "p".repeat(43),
			loggerPendingPairingExpiry: new Date(Date.now() - 60_000).toISOString(),
		});
		const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
			if (url.endsWith("/owner/credentials")) {
				const body = JSON.parse(String(init?.body)) as { deployment_id: string; expires_at: string };
				expect(body.deployment_id).toBe("coder-test");
				return new Response(JSON.stringify({ token: manage, credential: { scope: "manage", expires_at: body.expires_at } }), { status: 201 });
			}
			if (url.endsWith("/retention")) return new Response(JSON.stringify({ enabled: false, days: 0 }));
			const body = JSON.parse(String(init?.body)) as { expires_at: string };
			return new Response(JSON.stringify({ token: "i".repeat(43), credential: { scope: "ingest", app: "flixer", expires_at: body.expires_at } }), { status: 201 });
		});
		vi.stubGlobal("fetch", fetcher);
		expect(await new LoggerService({ requireAdmin }).bootstrapLocal(ownerPath, endpoint)).toBe(true);
		expect(store.get("loggerManageToken")).toBe(manage);
		expect(store.get("loggerLocalDeploymentId")).toBe("coder-test");
		expect(store.get("loggerPendingPairingToken")).toBeUndefined();
		expect(fetcher.mock.calls.filter(([url]) => url.endsWith("/owner/credentials"))).toHaveLength(1);
	});

	it("does not overwrite pending bootstrap state changed during expired credential replacement", async () => {
		const ownerPath = join(directory, "owner");
		writeFileSync(ownerPath, "o".repeat(43), { mode: 0o600 });
		const endpoint = "http://127.0.0.1:8098";
		store.setMany({
			loggerLocalDeploymentId: "coder-test", loggerLocalPending: "true",
			loggerPendingPairingUrl: endpoint, loggerPendingPairingToken: "p".repeat(43),
			loggerPendingPairingExpiry: new Date(Date.now() - 60_000).toISOString(),
		});
		vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
			store.setMany({ loggerPendingPairingToken: "x".repeat(43) });
			const body = JSON.parse(String(init?.body)) as { expires_at: string };
			return new Response(JSON.stringify({ token: manage, credential: { scope: "manage", expires_at: body.expires_at } }), { status: 201 });
		}));
		await expect(new LoggerService({ requireAdmin }).bootstrapLocal(ownerPath, endpoint)).rejects.toThrow("configuration changed");
		expect(store.get("loggerUrl")).toBeUndefined();
		expect(store.get("loggerPendingPairingToken")).toBe("x".repeat(43));
	});

	it("does not overwrite a changed local connection during management renewal", async () => {
		const ownerPath = join(directory, "owner");
		writeFileSync(ownerPath, "o".repeat(43), { mode: 0o600 });
		store.setMany({
			loggerUrl: "http://127.0.0.1:8098", loggerManageToken: manage,
			loggerManageExpiry: new Date(Date.now() + 60_000).toISOString(),
			loggerLocalManaged: "true", loggerLocalDeploymentId: "coder-test",
		});
		let release!: () => void;
		let started!: () => void;
		const blocked = new Promise<void>((resolve) => { release = resolve; });
		const entered = new Promise<void>((resolve) => { started = resolve; });
		vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
			if (url.endsWith("/owner/credentials")) {
				started();
				await blocked;
				const body = JSON.parse(String(init?.body)) as { expires_at: string };
				return new Response(JSON.stringify({ token: "n".repeat(43), credential: { scope: "manage", expires_at: body.expires_at } }), { status: 201 });
			}
			return new Response(JSON.stringify({ enabled: false, days: 0 }));
		}));
		const service = new LoggerService({ requireAdmin });
		const pending = service.bootstrapLocal(ownerPath, "http://127.0.0.1:8098");
		await entered;
		store.setMany({ loggerUrl: "https://new.example", loggerManageToken: "x".repeat(43) }, ["loggerLocalManaged"]);
		release();
		await expect(pending).rejects.toThrow("configuration changed");
		expect(store.get("loggerManageToken")).toBe("x".repeat(43));
	});

	it("resumes a failed renewal without issuing another management credential", async () => {
		const ownerPath = join(directory, "owner");
		writeFileSync(ownerPath, "o".repeat(43), { mode: 0o600 });
		const expiry = new Date(Date.now() + 60_000).toISOString();
		store.setMany({
			loggerUrl: "http://127.0.0.1:8098", loggerManageToken: manage, loggerManageExpiry: expiry,
			loggerLocalManaged: "true", loggerLocalDeploymentId: "coder-test",
		});
		let fail = true;
		const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
			if (url.endsWith("/owner/credentials")) {
				const body = JSON.parse(String(init?.body)) as { expires_at: string };
				return new Response(JSON.stringify({ token: "n".repeat(43), credential: { scope: "manage", expires_at: body.expires_at } }), { status: 201 });
			}
			return fail ? new Response("", { status: 503 }) : new Response(JSON.stringify({ enabled: false, days: 0 }));
		});
		vi.stubGlobal("fetch", fetcher);
		const service = new LoggerService({ requireAdmin });
		await expect(service.bootstrapLocal(ownerPath, "http://127.0.0.1:8098")).rejects.toThrow();
		expect(store.get("loggerManageToken")).toBe(manage);
		expect(store.get("loggerManageExpiry")).toBe(expiry);
		expect(store.get("loggerLocalRenewalToken")).toBe("n".repeat(43));
		expect(readFileSync(join(directory, "flixer-config.db")).includes("n".repeat(43))).toBe(false);
		fail = false;
		expect(await service.bootstrapLocal("/missing/owner", "http://127.0.0.1:8098")).toBe(true);
		expect(store.get("loggerManageToken")).toBe("n".repeat(43));
		expect(store.get("loggerLocalRenewalToken")).toBeUndefined();
		expect(fetcher.mock.calls.filter(([url]) => url.endsWith("/owner/credentials"))).toHaveLength(1);
	});

	it("replaces an expired pending local renewal without changing producer credentials", async () => {
		const ownerPath = join(directory, "owner");
		writeFileSync(ownerPath, "o".repeat(43), { mode: 0o600 });
		const endpoint = "http://127.0.0.1:8098";
		const expiry = new Date(Date.now() - 60_000).toISOString();
		const binding = createHash("sha256").update(JSON.stringify([endpoint, "coder-test", manage, expiry])).digest("hex");
		store.setMany({
			loggerUrl: endpoint, loggerManageToken: manage, loggerManageExpiry: expiry,
			loggerLocalManaged: "true", loggerLocalDeploymentId: "coder-test",
			loggerLocalRenewalToken: "p".repeat(43), loggerLocalRenewalExpiry: expiry, loggerLocalRenewalBinding: binding,
			loggerIngestToken: "i".repeat(43),
		});
		const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
			if (url.endsWith("/owner/credentials")) {
				const body = JSON.parse(String(init?.body)) as { expires_at: string };
				return new Response(JSON.stringify({ token: "n".repeat(43), credential: { scope: "manage", expires_at: body.expires_at } }), { status: 201 });
			}
			return new Response(JSON.stringify({ enabled: false, days: 0 }));
		});
		vi.stubGlobal("fetch", fetcher);
		await new LoggerService({ requireAdmin }).bootstrapLocal(ownerPath, endpoint);
		expect(store.get("loggerManageToken")).toBe("n".repeat(43));
		expect(store.get("loggerIngestToken")).toBe("i".repeat(43));
		expect(store.get("loggerLocalRenewalToken")).toBeUndefined();
		expect(fetcher.mock.calls.filter(([url]) => url.endsWith("/owner/credentials"))).toHaveLength(1);
	});

	it("does not overwrite pending renewal state changed during expired credential replacement", async () => {
		const ownerPath = join(directory, "owner");
		writeFileSync(ownerPath, "o".repeat(43), { mode: 0o600 });
		const endpoint = "http://127.0.0.1:8098";
		const expiry = new Date(Date.now() - 60_000).toISOString();
		const binding = createHash("sha256").update(JSON.stringify([endpoint, "coder-test", manage, expiry])).digest("hex");
		store.setMany({
			loggerUrl: endpoint, loggerManageToken: manage, loggerManageExpiry: expiry,
			loggerLocalManaged: "true", loggerLocalDeploymentId: "coder-test",
			loggerLocalRenewalToken: "p".repeat(43), loggerLocalRenewalExpiry: expiry, loggerLocalRenewalBinding: binding,
		});
		vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
			store.setMany({ loggerLocalRenewalToken: "x".repeat(43) });
			const body = JSON.parse(String(init?.body)) as { expires_at: string };
			return new Response(JSON.stringify({ token: "n".repeat(43), credential: { scope: "manage", expires_at: body.expires_at } }), { status: 201 });
		}));
		await expect(new LoggerService({ requireAdmin }).bootstrapLocal(ownerPath, endpoint)).rejects.toThrow("configuration changed");
		expect(store.get("loggerManageToken")).toBe(manage);
		expect(store.get("loggerLocalRenewalToken")).toBe("x".repeat(43));
	});

	it("refuses unsafe local bootstrap credential files before making a request", async () => {
		const ownerPath = join(directory, "owner");
		const linkPath = join(directory, "link");
		writeFileSync(ownerPath, "o".repeat(43), { mode: 0o600 });
		symlinkSync(ownerPath, linkPath);
		const fetcher = vi.fn();
		vi.stubGlobal("fetch", fetcher);
		const service = new LoggerService({ requireAdmin });
		await expect(service.bootstrapLocal(linkPath, "http://127.0.0.1:8098")).rejects.toThrow();
		chmodSync(ownerPath, 0o644);
		await expect(service.bootstrapLocal(ownerPath, "http://127.0.0.1:8098")).rejects.toThrow("not private");
		chmodSync(ownerPath, 0o600);
		chmodSync(directory, 0o755);
		await expect(service.bootstrapLocal(ownerPath, "http://127.0.0.1:8098")).rejects.toThrow("not private");
		chmodSync(directory, 0o700);
		expect(fetcher).not.toHaveBeenCalled();
	});

	it.runIf(process.platform !== "win32")("rejects a FIFO owner file without blocking bootstrap", async () => {
		const ownerPath = join(directory, "owner-pipe");
		execFileSync("mkfifo", ["-m", "600", ownerPath]);
		const fetcher = vi.fn();
		vi.stubGlobal("fetch", fetcher);
		const service = new LoggerService({ requireAdmin });
		await expect(service.bootstrapLocal(ownerPath, "http://127.0.0.1:8098")).rejects.toThrow("not private");
		expect(fetcher).not.toHaveBeenCalled();
	});

	it("allows an administrator to discard a pending credential without revoking it at the logger", async () => {
		store.setMany({
			loggerPendingPairingUrl: "https://logger.example", loggerPendingPairingToken: manage,
			loggerPendingPairingExpiry: new Date(Date.now() - 1_000).toISOString(),
		});
		const service = new LoggerService({ requireAdmin });
		await expect(service.retryPairing("admin")).rejects.toThrow("no valid pending");
		await expect(service.discardPairing("bad")).rejects.toThrow("forbidden");
		expect(await service.discardPairing("admin")).toEqual({ discarded: true });
		expect(store.get("loggerPendingPairingToken")).toBeUndefined();
		expect(await service.pairingStatus("admin")).toEqual({ pending: false, endpoint: null });
	});

	it("does not overwrite a discard performed while manual registration is in flight", async () => {
		store.setMany({
			loggerPendingPairingUrl: "https://old.example", loggerPendingPairingToken: manage,
			loggerPendingPairingExpiry: new Date(Date.now() + 60_000).toISOString(),
		});
		let releaseRetention!: () => void;
		let startedRetention!: () => void;
		const started = new Promise<void>((resolve) => { startedRetention = resolve; });
		const blocked = new Promise<void>((resolve) => { releaseRetention = resolve; });
		vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
			if (url.endsWith("/retention")) {
				startedRetention();
				await blocked;
				return new Response(JSON.stringify({ enabled: false, days: 0 }));
			}
			const body = JSON.parse(String(init?.body)) as { expires_at: string };
			return new Response(JSON.stringify({ token: "i".repeat(43), credential: { scope: "ingest", app: "flixer", expires_at: body.expires_at } }), { status: 201 });
		}));
		const service = new LoggerService({ requireAdmin });
		const registration = service.configure({ endpoint: "https://logger.example", manageToken: manage }, "admin");
		await started;
		await service.discardPairing("admin");
		releaseRetention();
		await expect(registration).rejects.toThrow("configuration changed");
		expect(store.get("loggerUrl")).toBeUndefined();
		expect(store.get("loggerPendingPairingToken")).toBeUndefined();
	});

	it("rejects unsafe endpoints, malformed tokens and mismatched deployment responses", async () => {
		const service = new LoggerService({ requireAdmin });
		const fetcher = vi.fn(async () => new Response(JSON.stringify({
			deployment_id: "other", token: manage,
			credential: { scope: "manage", expires_at: new Date(Date.now() + 60_000).toISOString() },
		}), { status: 201 }));
		vi.stubGlobal("fetch", fetcher);
		await expect(service.pair({ endpoint: "http://remote.example", deploymentId: "tenant", pairingToken }, "admin")).rejects.toThrow();
		await expect(service.pair({ endpoint: "https://logger.example", deploymentId: "tenant", pairingToken: "invalid" }, "admin")).rejects.toThrow();
		expect(fetcher).not.toHaveBeenCalled();
		await expect(service.pair({ endpoint: "https://logger.example", deploymentId: "tenant", pairingToken }, "admin")).rejects.toThrow();
		expect(await service.pairingStatus("admin")).toEqual({ pending: false, endpoint: null });
	});

	it("requires owner access and validates management credential responses and revocation input", async () => {
		store.setMany({
			loggerUrl: "https://logger.example", loggerManageToken: manage,
			loggerOwnerUrl: "https://logger.example", loggerOwnerToken: "o".repeat(43),
		});
		const service = new LoggerService({ requireAdmin });
		const fetcher = vi.fn(async () => new Response(JSON.stringify({
			credentials: [{ id: "a".repeat(32), scope: "query", expires_at: new Date(Date.now() + 60_000).toISOString() }],
		})));
		vi.stubGlobal("fetch", fetcher);
		await expect(service.listOwnerCredentials("tenant", "bad")).rejects.toThrow("forbidden");
		await expect(service.revokeOwnerCredential("tenant", "../invalid", "admin")).rejects.toThrow("Invalid credential");
		expect(fetcher).not.toHaveBeenCalled();
		await expect(service.listOwnerCredentials("tenant", "admin")).rejects.toThrow("invalid credentials");
		store.setMany({}, ["loggerOwnerToken"]);
		await expect(service.listOwnerCredentials("tenant", "admin")).rejects.toThrow("not configured");
	});
});
import { execFileSync } from "node:child_process";
