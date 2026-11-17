import { describe, expect, it, vi } from "vitest";
import type { DataSource } from "typeorm";
import { PluginIndexerHostService } from "./pluginIndexerHostService.js";

describe("PluginIndexerHostService", () => {
	it("allows only approved network permissions for an enabled indexer target", async () => {
		const installation = { enabled: true, manifest: { targets: { "flixer-indexer": { entry: "provider.wasm" } }, capabilities: ["indexer.provider.movie"], permissions: ["network.http.api.example.com"] }, approvedPermissions: ["network.http.api.example.com", "network.http.evil.example"] };
		const dataSource = { getRepository: vi.fn(() => ({ findOneBy: vi.fn().mockResolvedValue(installation) })) } as unknown as DataSource;
		const settings = { effectiveValues: vi.fn().mockResolvedValue({ apiKey: "provider-secret" }) };
		const service = new PluginIndexerHostService(dataSource, settings as never);
		service.httpGet = vi.fn().mockResolvedValue({ status: 200, body: "ok" });
		const result = await service.execute("plugin.example", [
			{ id: "allowed", op: "http.get", url: "https://api.example.com/movie" },
			{ id: "denied", op: "http.get", url: "https://evil.example/movie" },
			{ id: "service", op: "users.list" },
		]);
		expect(result).toEqual([
			{ id: "allowed", ok: true, status: 200, body: "ok" },
			{ id: "denied", ok: false, error: "permission_denied" },
			{ id: "service", ok: false, error: "invalid_request" },
		]);
		expect(service.httpGet).toHaveBeenCalledOnce();
		installation.enabled = false;
		await expect(service.execute("plugin.example", [])).rejects.toThrow("not found");
	});

	it("only exposes its own settings when settings.read is declared and approved", async () => {
		const installation = { enabled: true, manifest: { targets: { "flixer-indexer": { entry: "provider.wasm" } }, capabilities: ["indexer.provider.movie"], permissions: ["settings.read"] }, approvedPermissions: [] as string[] };
		const dataSource = { getRepository: vi.fn(() => ({ findOneBy: vi.fn().mockResolvedValue(installation) })) } as unknown as DataSource;
		const settings = { effectiveValues: vi.fn().mockResolvedValue({ apiKey: "provider-secret" }) };
		const service = new PluginIndexerHostService(dataSource, settings as never);
		const calls = [{ id: "settings", op: "settings.get" }];
		await expect(service.execute("plugin.example", calls)).resolves.toEqual([{ id: "settings", ok: false, error: "permission_denied" }]);
		installation.approvedPermissions.push("settings.read");
		await expect(service.execute("plugin.example", calls)).resolves.toEqual([{ id: "settings", ok: true, settings: { apiKey: "provider-secret" } }]);
		expect(settings.effectiveValues).toHaveBeenCalledWith(installation);
	});
});