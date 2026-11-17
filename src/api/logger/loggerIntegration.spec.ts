import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AppConfig, setAppConfig } from "../../config/store/appConfig.js";
import { ConfigStore } from "../../config/store/configStore.js";
import { LoggerService } from "./loggerService.js";
import { loggerExporter } from "../../logs/loggerExporter.js";

const endpoint = process.env.LOGGER_INTEGRATION_URL;
const manageToken = process.env.LOGGER_INTEGRATION_MANAGE_TOKEN;

describe("logger control-plane integration", () => {
	it.runIf(Boolean(endpoint && manageToken))("configures a live logger and uses a brokered query credential", async () => {
		if (!endpoint || !manageToken) throw new Error("Logger integration configuration is missing.");
		const directory = mkdtempSync(join(tmpdir(), "flixer-logger-integration-"));
		const store = new ConfigStore(directory);
		setAppConfig(new AppConfig(store));
		try {
			const service = new LoggerService({ requireAdmin: async () => undefined });
			expect(await service.configure({ endpoint, manageToken }, "Bearer admin")).toEqual({ configured: true, endpoint });
			expect(await service.health("Bearer admin")).toMatchObject({ status: "ready", exporter: { enabled: true } });
			expect(await service.setIngestionPolicy({ eventsPerSecond: 1000, burst: 3000 }, "Bearer admin")).toEqual({ eventsPerSecond: 1000, burst: 3000 });
			expect(await service.getIngestionPolicy("Bearer admin")).toEqual({ eventsPerSecond: 1000, burst: 3000 });
			expect(await service.setRetention({ enabled: false, days: 14 }, "Bearer admin")).toEqual({ enabled: false, days: 14 });
			const ticket = await service.issueQueryToken("Bearer admin");
			expect(await service.setQuota({ maxBytes: 4096 }, "admin")).toEqual({ maxBytes: 4096, usedBytes: 0 });
			const ratePolicy = { eventsPerSecond: 1000, burst: 3000, credentialEventsPerSecond: 100, credentialBurst: 1000, serviceEventsPerSecond: 500, serviceBurst: 1000 };
			expect(await service.setIngestionPolicy(ratePolicy, "admin")).toEqual(ratePolicy);
			expect(await service.getIngestionPolicy("admin")).toEqual(ratePolicy);
			expect(await service.setRetention({ enabled: false, days: 14, severityDays: { error: 30, trace: 2 } }, "admin")).toEqual({
				enabled: false, days: 14, severityDays: { error: 30, trace: 2 },
			});
			expect(await service.getRetention("admin")).toEqual({ enabled: false, days: 14, severityDays: { error: 30, trace: 2 } });
			expect(await service.getQuota("admin")).toEqual({ maxBytes: 4096, usedBytes: 0 });
			expect(await service.setQuota({ maxBytes: 0 }, "admin")).toEqual({ maxBytes: 0, usedBytes: 0 });
			const response = await fetch(`${ticket.endpoint}/api/logs`, {
				headers: { authorization: `Bearer ${ticket.token}` },
				signal: AbortSignal.timeout(5_000),
			});
			expect(response.status).toBe(200);
			expect(await response.json()).toMatchObject({ events: [] });
			loggerExporter.enqueue({
				time: new Date().toISOString(),
				level: "info",
				app: "flixer",
				source: "logger-integration",
				message: "integration event password=supersecret",
			});
			let found = false;
			for (let attempt = 0; attempt < 30 && !found; attempt++) {
				await new Promise((resolve) => setTimeout(resolve, 200));
				const result = await fetch(`${ticket.endpoint}/api/logs`, {
					headers: { authorization: `Bearer ${ticket.token}` },
					signal: AbortSignal.timeout(5_000),
				});
				const payload = await result.json() as { events: { source: string; message: string }[] };
				const event = payload.events.find((item) => item.source === "logger-integration");
				if (event) {
					expect(event.message).not.toContain("supersecret");
					found = true;
				}
			}
			expect(found).toBe(true);
			expect((await service.status("admin")).last_ingested_at).not.toBeNull();
			expect((await service.listCredentials("admin")).some((credential) => credential.scope === "ingest")).toBe(true);
			for (let attempt = 0; attempt < 30 && loggerExporter.status().sending; attempt++) {
				await new Promise((resolve) => setTimeout(resolve, 100));
			}
			expect(loggerExporter.status()).toMatchObject({ sending: false, dropped: 0 });
			const queryCredential = (await service.listCredentials("admin")).find((credential) => credential.scope === "query");
			const credentials = await service.listCredentials("admin");
			expect(credentials.some((credential) => credential.scope === "ingest" && credential.app === "flixer")).toBe(true);
			store.setMany({ loggerIngestApp: "" });
			await service.renewIngestCredential();
			expect(store.get("loggerIngestApp")).toBe("flixer");
			expect((await service.listCredentials("admin")).filter((credential) =>
				credential.scope === "ingest" && credential.app === "flixer",
			)).toHaveLength(2);
			expect(queryCredential).toBeDefined();
			if (!queryCredential) throw new Error("Missing query credential.");
			expect(await service.revokeCredential(queryCredential.id, "admin")).toEqual({ revoked: true });
			const revoked = await fetch(`${ticket.endpoint}/api/logs`, {
				headers: { authorization: `Bearer ${ticket.token}` },
				signal: AbortSignal.timeout(5_000),
			});
			expect(revoked.status).toBe(401);
		} finally {
			loggerExporter.configure();
			setAppConfig(undefined);
			store.close();
			rmSync(directory, { recursive: true, force: true });
		}
	});
});
