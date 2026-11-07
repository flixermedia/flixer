import "reflect-metadata";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { request, type Server } from "node:http";
import { describe, expect, it, vi } from "vitest";
import { Configuration } from "@tsed/di";
import { Unauthorized } from "@tsed/exceptions";
import { PlatformFastify } from "@tsed/platform-fastify";
import { AppConfig, setAppConfig } from "../../config/store/appConfig.js";
import { ConfigStore } from "../../config/store/configStore.js";
import { DefaultDataSource } from "../../datasources/defaultDataSource.datasource.js";
import { loggerExporter } from "../../logs/loggerExporter.js";
import { AuthService } from "../auth/authService.js";
import { LoggerController } from "./loggerController.js";
import { LoggerService } from "./loggerService.js";
import { LoggerQueryProxy } from "./loggerQueryProxy.js";
import { startLoggerControlSocket } from "./loggerControlSocket.js";
import { signIndexerRequest } from "../indexer/indexerAuth.js";

const binary = process.env.FLIXER_LOGGER_TEST_BINARY;

@Configuration({})
class LoggerTestServer {}

async function unusedPort(): Promise<number> {
	const listener = createServer();
	listener.listen(0, "127.0.0.1");
	await once(listener, "listening");
	const address = listener.address();
	if (!address || typeof address === "string") throw new Error("Cannot determine test port.");
	await new Promise<void>((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()));
	return address.port;
}

async function waitReady(endpoint: string, process: ChildProcess): Promise<void> {
	for (let attempt = 0; attempt < 100; attempt++) {
		if (process.exitCode !== null || process.signalCode !== null) throw new Error("Test logger exited before readiness.");
		try {
			const response = await fetch(`${endpoint}/api/health/live`, { signal: AbortSignal.timeout(500) });
			if (response.ok) return;
		} catch {
			// The logger has not started listening yet.
		}
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	throw new Error("Test logger did not become ready.");
}

async function socketCredential(socketPath: string, app: string): Promise<{ endpoint: string; token: string; expiresAt: string }> {
	const path = `/api/internal/logger/${app}`;
	return new Promise((resolve, reject) => {
		const req = request({ socketPath, path, headers: signIndexerRequest("GET", path, new Uint8Array()) }, (res) => {
			let body = "";
			res.setEncoding("utf8");
			res.on("data", (chunk: string) => { body += chunk; });
			res.on("end", () => {
				if (res.statusCode !== 200) reject(new Error(`Socket enrollment returned ${res.statusCode}`));
				else resolve(JSON.parse(body) as { endpoint: string; token: string; expiresAt: string });
			});
		});
		req.on("error", reject);
		req.end();
	});
}

describe("real logger owner integration", () => {
	it.runIf(Boolean(binary))("isolates owner access and applies and recovers from a global capacity guard", async () => {
		if (!binary) throw new Error("FLIXER_LOGGER_TEST_BINARY is required.");
		const directory = mkdtempSync(join(tmpdir(), "flixer-owner-integration-"));
		const ownerPath = join(directory, "owner-token");
		const store = new ConfigStore(join(directory, "config"));
		const endpoint = `http://127.0.0.1:${await unusedPort()}`;
		const process = spawn(binary, ["--data-dir", join(directory, "data"), "--bootstrap-owner-file", ownerPath, "--listen", new URL(endpoint).host], { stdio: "ignore" });
		const processExit = once(process, "exit").then(() => undefined, () => undefined);
		let socket: Server | undefined;
		try {
			await once(process, "spawn");
			await waitReady(endpoint, process);
			const owner = readFileSync(ownerPath, "utf8");
			const issued = await fetch(`${endpoint}/api/owner/pairings`, {
				method: "POST",
				headers: { authorization: `Bearer ${owner}`, "content-type": "application/json" },
				body: JSON.stringify({
					deployment_id: "tenant", expires_at: new Date(Date.now() + 5 * 60_000).toISOString(),
					management_expiry: new Date(Date.now() + 60 * 60_000).toISOString(),
				}),
			});
			expect(issued.status).toBe(201);
			const { token: pairingToken } = await issued.json() as { token: string };
			setAppConfig(new AppConfig(store));
			vi.stubEnv("APP_SECRET", "test-shared-secret-with-at-least-32-bytes");
			const service = new LoggerService({ requireAdmin: async () => {} });
			expect(await service.pair({ endpoint, deploymentId: "tenant", pairingToken })).toMatchObject({ configured: true, endpoint, managementExpiresAt: expect.any(String) });
			const socketPath = join(directory, "control.sock");
			socket = await startLoggerControlSocket(socketPath, service);
			const manage = store.get("loggerManageToken");
			expect(manage).toBeDefined();
			const ingest = store.get("loggerIngestToken");
			if (!ingest) throw new Error("Missing ingestion credential.");
			const { token: query } = await service.issueQueryToken();
			const ai = await service.producerIngestConfiguration("flixer-ai");
			expect(ai.endpoint).toBe(endpoint);
			const aiEvent = { schema_version: 1, event_id: "ai-enrollment-event", time: new Date().toISOString(), level: "info", instance_id: "ai", app: "flixer-ai", message: "AI enrollment" };
			const sendAi = (app: string) => fetch(`${endpoint}/api/logs/batch`, {
				method: "POST",
				headers: { authorization: `Bearer ${ai.token}`, "content-type": "application/json" },
				body: JSON.stringify({ events: [{ ...aiEvent, app }] }),
			});
			expect((await sendAi("flixer")).status).toBe(403);
			expect((await sendAi("flixer-ai")).status).toBe(200);
			const aiResults = await fetch(`${endpoint}/api/logs`, { headers: { authorization: `Bearer ${query}` } });
			expect(JSON.stringify(await aiResults.json())).toContain("ai-enrollment-event");
			const relay = new LoggerQueryProxy({ requireAdmin: async (authorization) => {
				if (authorization !== "Bearer admin") throw new Error("Admin required.");
			} }, service);
			await expect(relay.query("recent", "", undefined, undefined)).rejects.toThrow("Admin required");
			const relayed = await relay.query("recent", "?limit=10", undefined, undefined, "Bearer admin");
			let relayedBody = "";
			for await (const chunk of relayed.stream) relayedBody += chunk.toString();
			expect(relayedBody).toContain("ai-enrollment-event");
			expect(relayedBody).not.toContain(query);
			const indexer = await service.producerIngestConfiguration("flixer-indexer");
			const taskStart = new Date(Date.now() - 60_000).toISOString();
			for (const [id, queue] of [["task-first", "scan"], ["task-other", "probe"], ["task-second", "scan"]]) {
				expect((await fetch(`${endpoint}/api/logs/batch`, {
					method: "POST", headers: { authorization: `Bearer ${indexer.token}`, "content-type": "application/json" },
					body: JSON.stringify({ events: [{ ...aiEvent, event_id: id, app: "flixer-indexer", task_id: "same-task", fields: { task_queue: queue } }] }),
				})).status).toBe(200);
			}
			const taskSearch = {
				start: taskStart, end: new Date(Date.now() + 60_000).toISOString(), limit: 1,
				order: "oldest", follow: true, fields: { app: "flixer-indexer", task: "same-task", task_queue: "scan" },
			};
			const taskRelay = new LoggerQueryProxy({ requireAdmin: async (authorization) => {
				if (authorization !== "admin") throw new Error("Admin required.");
			} }, service);
			const taskPage = async (cursor?: string) => {
				const response = await taskRelay.query("search", "", { ...taskSearch, ...(cursor ? { cursor } : {}) }, undefined, "admin");
				let body = "";
				for await (const chunk of response.stream) body += chunk.toString();
				return JSON.parse(body) as { events: Array<{ event_id: string }>; next_cursor: string };
			};
			const firstTaskPage = await taskPage();
			expect(firstTaskPage.events.map((event) => event.event_id)).toEqual(["task-first"]);
			expect(firstTaskPage.next_cursor).toBeTruthy();
			const secondTaskPage = await taskPage(firstTaskPage.next_cursor);
			expect(secondTaskPage.events.map((event) => event.event_id)).toEqual(["task-second"]);
			expect(secondTaskPage.next_cursor).toBeTruthy();
			expect((await taskPage(secondTaskPage.next_cursor)).events).toEqual([]);
			expect((await fetch(`${endpoint}/api/logs/batch`, {
				method: "POST", headers: { authorization: `Bearer ${indexer.token}`, "content-type": "application/json" },
				body: JSON.stringify({ events: [{ ...aiEvent, event_id: "task-later", app: "flixer-indexer", task_id: "same-task", fields: { task_queue: "scan" } }] }),
			})).status).toBe(200);
			expect((await taskPage(secondTaskPage.next_cursor)).events.map((event) => event.event_id)).toEqual(["task-later"]);
			const live = await relay.query("stream", "", undefined, undefined, "Bearer admin");
			const liveEvent = new Promise<string>((resolve, reject) => {
				let data = "";
				const timeout = setTimeout(() => reject(new Error("Timed out waiting for live event.")), 5000);
				live.stream.on("error", reject);
				live.stream.on("data", (chunk: Buffer) => {
					data += chunk.toString();
					if (data.includes("live-relay-event") && data.includes("\n\n")) {
						clearTimeout(timeout);
						resolve(data);
					}
				});
			});
			expect((await fetch(`${endpoint}/api/logs/batch`, {
				method: "POST", headers: { authorization: `Bearer ${ai.token}`, "content-type": "application/json" },
				body: JSON.stringify({ events: [{ ...aiEvent, event_id: "live-relay-event" }] }),
			})).status).toBe(200);
			const liveData = await liveEvent;
			const cursor = /^id: (.+)$/m.exec(liveData)?.[1];
			expect(cursor).toBeTruthy();
			live.abort();
			live.stream.destroy();
			expect((await fetch(`${endpoint}/api/logs/batch`, {
				method: "POST", headers: { authorization: `Bearer ${ai.token}`, "content-type": "application/json" },
				body: JSON.stringify({ events: [{ ...aiEvent, event_id: "replayed-relay-event" }] }),
			})).status).toBe(200);
			const replay = await relay.query("stream", "", undefined, cursor, "Bearer admin");
			const replayed = await new Promise<string>((resolve, reject) => {
				let data = "";
				const timeout = setTimeout(() => reject(new Error("Timed out waiting for replay.")), 5000);
				replay.stream.on("error", reject);
				replay.stream.on("data", (chunk: Buffer) => {
					data += chunk.toString();
					if (data.includes("replayed-relay-event")) {
						clearTimeout(timeout);
						resolve(data);
					}
				});
			});
			expect(replayed).toContain("replayed-relay-event");
			replay.abort();
			replay.stream.destroy();
			const auth = { requireAdmin: async (authorization?: string) => {
				if (authorization !== "Bearer admin") throw new Unauthorized("Admin required.");
			} };
			const platform = await PlatformFastify.bootstrap(LoggerTestServer, {
				httpPort: false, httpsPort: false, mount: { "/api": [LoggerController] },
				plugins: ["@fastify/accepts"],
				imports: [
					{ token: DefaultDataSource, use: {} },
					{ token: AuthService, use: auth },
					{ token: LoggerService, use: new LoggerService(auth) },
					LoggerQueryProxy,
				],
			});
			try {
				await platform.listen(false);
				const app = platform.adapter.app.getApp();
				const denied = await app.inject({ method: "GET", url: "/api/admin/logger/data/recent" });
				expect(denied.statusCode).toBe(401);
				const recent = await app.inject({
					method: "GET", url: "/api/admin/logger/data/recent?limit=10",
					headers: { authorization: "Bearer admin" },
				});
				expect(recent.statusCode).toBe(200);
				expect(recent.body).toContain("ai-enrollment-event");
				expect(recent.body).not.toContain(query);
				expect(recent.body).not.toContain(manage);
				const search = await app.inject({
					method: "POST", url: "/api/admin/logger/data/search", headers: { authorization: "Bearer admin" },
					payload: { start: new Date(Date.now() - 60_000).toISOString(), end: new Date(Date.now() + 60_000).toISOString(), limit: 10, text: "enrollment" },
				});
				expect(search.statusCode).toBe(200);
				expect(search.body).toContain("ai-enrollment-event");
				const address = await app.listen({ host: "127.0.0.1", port: 0 });
				const downstream = new AbortController();
				try {
					const streamed = await fetch(`${address}/api/admin/logger/data/stream?app=flixer-ai`, {
						headers: { authorization: "Bearer admin" }, signal: downstream.signal,
					});
					if (streamed.status !== 200) throw new Error(`Live relay returned ${streamed.status}: ${await streamed.text()}`);
					expect(streamed.headers.get("content-type")).toMatch(/^text\/event-stream/);
					const reader = streamed.body?.getReader();
					if (!reader) throw new Error("Missing live response body.");
					expect(new TextDecoder().decode((await reader.read()).value)).toContain(": connected");
					await vi.waitFor(async () => expect((await service.status()).live_subscribers).toBe(1));
					downstream.abort();
					await vi.waitFor(async () => expect((await service.status()).live_subscribers).toBe(0), { timeout: 5000 });
				} finally {
					downstream.abort();
				}
			} finally {
				await platform.stop();
			}
			for (const app of ["flixer-indexer", "flixer-streamer", "flixer-updater"] as const) {
				const producer = await socketCredential(socketPath, app.replace("flixer-", ""));
				expect(producer.endpoint).toBe(endpoint);
				const sendProducer = (eventApp: string) => fetch(`${endpoint}/api/logs/batch`, {
					method: "POST",
					headers: { authorization: `Bearer ${producer.token}`, "content-type": "application/json" },
					body: JSON.stringify({ events: [{ ...aiEvent, event_id: `integration-${app}`, app: eventApp }] }),
				});
				expect((await sendProducer("flixer-ai")).status).toBe(403);
				expect((await sendProducer(app)).status).toBe(200);
				const credential = (await service.listCredentials()).find((item) => item.app === app);
				if (!credential) throw new Error(`Missing ${app} credential.`);
				await service.revokeCredential(credential.id);
				expect((await sendProducer(app)).status).toBe(401);
				const replacement = await socketCredential(socketPath, app.replace("flixer-", ""));
				expect(replacement.token).not.toBe(producer.token);
				expect((await fetch(`${endpoint}/api/logs/batch`, {
					method: "POST",
					headers: { authorization: `Bearer ${replacement.token}`, "content-type": "application/json" },
					body: JSON.stringify({ events: [{ ...aiEvent, event_id: `replacement-${app}`, app }] }),
				})).status).toBe(200);
			}
			expect(await service.configureOwner({ ownerToken: owner })).toEqual({ configured: true });
			const invitation = await service.createOwnerPairing({ deploymentId: "another-tenant", minutes: 5, managementDays: 30 });
			expect(invitation.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
			expect(await service.listOwnerPairings("another-tenant")).toEqual([{
				id: invitation.id, expiresAt: invitation.expiresAt, managementExpiry: invitation.managementExpiry,
			}]);
			expect(await service.listOwnerPairings("tenant")).toEqual([]);
			expect(await service.revokeOwnerPairing("another-tenant", invitation.id)).toEqual({ revoked: true });
			expect((await fetch(`${endpoint}/api/logger/pairings/redeem`, {
				method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: invitation.token }),
			})).status).toBe(401);
			expect((await service.ownerCapacity()).filesystem_total_bytes).toBeGreaterThan(0);
			expect((await fetch(`${endpoint}/api/owner/capacity`, { headers: { authorization: `Bearer ${manage}` } })).status).toBe(401);
			expect((await fetch(`${endpoint}/api/logs`, { headers: { authorization: `Bearer ${owner}` } })).status).toBe(401);
			expect(await service.setCapacityPolicy({ maxDatabaseBytes: 1, minFreeBytes: 0 })).toEqual({ maxDatabaseBytes: 1, minFreeBytes: 0 });
			expect(await service.getCapacityPolicy()).toEqual({ maxDatabaseBytes: 1, minFreeBytes: 0 });
			const event = { schema_version: 1, event_id: "integration-event", time: new Date().toISOString(), level: "info", instance_id: "node", app: "flixer", message: "integration" };
			const send = () => fetch(`${endpoint}/api/logs/batch`, {
				method: "POST", headers: { authorization: `Bearer ${ingest}`, "content-type": "application/json" }, body: JSON.stringify({ events: [event] }),
			});
			const rejected = await send();
			expect(rejected.status).toBe(503);
			expect(rejected.headers.get("retry-after")).toBeTruthy();
			expect((await fetch(`${endpoint}/api/logs`, { headers: { authorization: `Bearer ${query}` } })).status).toBe(200);
			await service.setCapacityPolicy({ maxDatabaseBytes: 0, minFreeBytes: 0 });
			expect((await send()).status).toBe(200);
			const response = await fetch(`${endpoint}/api/logs`, { headers: { authorization: `Bearer ${query}` } });
			expect(JSON.stringify(await response.json())).toContain("integration-event");
			expect((await service.status()).retention).toBeNull();
			const apiCredential = (await service.listCredentials()).find((item) => item.app === "flixer");
			if (!apiCredential) throw new Error("Missing Flixer ingestion credential.");
			await service.revokeCredential(apiCredential.id);
			expect((await send()).status).toBe(401);
			await service.renewIngestCredential();
			const replacement = store.get("loggerIngestToken");
			expect(replacement).toBeTruthy();
			expect(replacement).not.toBe(ingest);
			expect((await fetch(`${endpoint}/api/logs/batch`, {
				method: "POST", headers: { authorization: `Bearer ${replacement}`, "content-type": "application/json" },
				body: JSON.stringify({ events: [{ ...event, event_id: "integration-api-replacement" }] }),
			})).status).toBe(200);
			loggerExporter.enqueue({
				time: new Date().toISOString(), level: "info", app: "flixer",
				source: "owner-integration-exporter", message: "exported event",
			});
			await loggerExporter.shutdown(2_000);
			const exported = await fetch(`${endpoint}/api/logs`, { headers: { authorization: `Bearer ${query}` } });
			expect(JSON.stringify(await exported.json())).toContain("owner-integration-exporter");
			const management = await service.listOwnerCredentials("tenant");
			expect(management).toHaveLength(1);
			expect(management[0]).toMatchObject({ id: expect.any(String), expiresAt: expect.any(String) });
			expect(await service.listOwnerCredentials("another-tenant")).toEqual([]);
			expect(await service.revokeOwnerCredential("tenant", management[0].id)).toEqual({ revoked: true });
			await expect(service.getRetention()).rejects.toThrow();
			store.setMany({ loggerUrl: "http://127.0.0.1:1" });
			expect(await service.ownerConfiguration()).toEqual({ configured: false });
			await expect(service.ownerCapacity()).rejects.toThrow("not configured");
		} finally {
			if (socket) await new Promise<void>((resolve, reject) => socket!.close((error) => error ? reject(error) : resolve()));
			loggerExporter.configure();
			vi.unstubAllEnvs();
			setAppConfig(undefined);
			store.close();
			if (process.pid && process.exitCode === null && process.signalCode === null) process.kill("SIGTERM");
			await processExit;
			rmSync(directory, { recursive: true, force: true });
		}
	}, 30_000);

	it.runIf(Boolean(binary))("automatically bootstraps a local logger without replacing an existing connection", async () => {
		if (!binary) throw new Error("FLIXER_LOGGER_TEST_BINARY is required.");
		const directory = mkdtempSync(join(tmpdir(), "flixer-local-bootstrap-"));
		const ownerPath = join(directory, "owner-token");
		const store = new ConfigStore(join(directory, "config"));
		const endpoint = `http://127.0.0.1:${await unusedPort()}`;
		const process = spawn(binary, ["--data-dir", join(directory, "data"), "--bootstrap-owner-file", ownerPath, "--listen", new URL(endpoint).host], { stdio: "ignore" });
		const processExit = once(process, "exit").then(() => undefined, () => undefined);
		try {
			await once(process, "spawn");
			await waitReady(endpoint, process);
			setAppConfig(new AppConfig(store));
			const service = new LoggerService({ requireAdmin: async () => {} });
			expect(await service.bootstrapLocal(ownerPath, endpoint)).toBe(true);
			expect(store.get("loggerUrl")).toBe(endpoint);
			expect(store.get("loggerManageToken")).toMatch(/^[A-Za-z0-9_-]{43}$/);
			expect(store.get("loggerLocalDeploymentId")).toMatch(/^coder-/);
			expect(store.get("loggerLocalPending")).toBeUndefined();
			expect(store.get("loggerLocalManaged")).toBe("true");
			expect((await service.producerIngestConfiguration("flixer-ai")).endpoint).toBe(endpoint);
			const original = store.get("loggerManageToken");
			expect(await service.bootstrapLocal("/missing/owner", endpoint)).toBe(true);
			expect(store.get("loggerManageToken")).toBe(original);
			const ingest = store.get("loggerIngestToken");
			store.setMany({ loggerManageExpiry: new Date(Date.now() + 1000).toISOString() });
			expect(await service.bootstrapLocal(ownerPath, endpoint)).toBe(true);
			expect(store.get("loggerManageToken")).not.toBe(original);
			expect(store.get("loggerIngestToken")).toBe(ingest);
			expect(Date.parse(store.get("loggerManageExpiry") ?? "")).toBeGreaterThan(Date.now() + 300 * 86_400_000);
			expect(await service.getRetention()).toBeDefined();
			await expect(service.bootstrapLocal(ownerPath, "http://example.com:8098")).rejects.toThrow();

			if (!ingest) throw new Error("Missing ingestion credential.");
			const relay = new LoggerQueryProxy({ requireAdmin: async (authorization) => {
				if (authorization !== "admin") throw new Unauthorized("Admin required.");
			} }, service);
			const live = await relay.query("stream", "?app=flixer", undefined, undefined, "admin", AbortSignal.timeout(20_000));
			const expected = new Set(Array.from({ length: 1000 }, (_, i) => `batch-${i}`));
			try {
				const consume = async () => {
					let buffer = "";
					for await (const chunk of live.stream) {
						buffer += chunk.toString();
						let boundary = buffer.indexOf("\n\n");
						while (boundary !== -1) {
							const frame = buffer.slice(0, boundary);
							buffer = buffer.slice(boundary + 2);
							if (frame.includes("event: overflow")) throw new Error("Live stream overflowed.");
							if (frame.includes("event: log")) {
								const data = frame.split("\n").find((line) => line.startsWith("data: "));
								if (!data) throw new Error("Live event has no data.");
								const event = JSON.parse(data.slice(6)) as { event_id: string };
								if (!expected.delete(event.event_id)) throw new Error("Unexpected or duplicate live event.");
								if (expected.size === 0) return;
							}
							boundary = buffer.indexOf("\n\n");
						}
					}
					throw new Error(`Live stream ended with ${expected.size} events missing.`);
				};
				const send = async () => {
					const events = Array.from({ length: 1000 }, (_, i) => ({
						schema_version: 1, event_id: `batch-${i}`, time: new Date().toISOString(),
						level: "info", instance_id: "node", app: "flixer", message: "batch event",
					}));
					const response = await fetch(`${endpoint}/api/logs/batch`, {
						method: "POST", headers: { authorization: `Bearer ${ingest}`, "content-type": "application/json" },
						body: JSON.stringify({ events }),
					});
					expect(response.status).toBe(200);
				};
				await Promise.all([consume(), send()]);
			} finally {
				live.abort();
				live.stream.destroy();
			}
		} finally {
			loggerExporter.configure();
			setAppConfig(undefined);
			store.close();
			if (process.pid && process.exitCode === null && process.signalCode === null) process.kill("SIGTERM");
			await processExit;
			rmSync(directory, { recursive: true, force: true });
		}
	}, 30_000);
});
