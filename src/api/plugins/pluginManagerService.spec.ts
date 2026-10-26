import { describe, expect, it, vi } from "vitest";
import type { DataSource } from "typeorm";
import type { IndexerClient } from "../indexer/indexerClient.js";
import type { PluginManifest } from "./pluginManifest.js";
import {
	PluginManagerService,
	pluginUpdateErrorMessage,
	preservePluginInstallationState,
} from "./pluginManagerService.js";

describe("pluginUpdateErrorMessage", () => {
	it("redacts bearer tokens and credential-like URL parameters", () => {
		expect(
			pluginUpdateErrorMessage(
				new Error("Request failed with Bearer abc123 https://example.test/?api_key=secret&other=value"),
			),
		).toBe("Request failed with Bearer [redacted] https://example.test/?api_key=[redacted]&other=value");
	});

	it("limits stored diagnostics and handles non-error values", () => {
		expect(pluginUpdateErrorMessage("unknown")).toBe("Plugin installation failed.");
		expect(pluginUpdateErrorMessage(new Error("x".repeat(1200)))).toHaveLength(1000);
	});

	it("preserves settings and valid permission grants across package updates", () => {
		const existing = {
			settings: { endpoint: "https://example.test", existingField: "keep" },
			encryptedSecrets: { apiKey: "encrypted-secret" },
			approvedPermissions: ["network.external", "removed.permission"],
		};
		const manifest = {
			manifestVersion: 1,
			id: "flixer.example",
			name: "Example",
			version: "2.0.0",
			description: "Example plugin",
			author: "Flixer",
			license: "MIT",
			compatibility: { pluginApi: "^1.0.0" },
			targets: { "flixer-indexer": { entry: "provider.wasm" } },
			capabilities: ["indexer.provider.movie"],
			permissions: ["network.external", "settings.read"],
		} satisfies PluginManifest;

		expect(preservePluginInstallationState(existing, manifest, ["settings.read"])).toEqual({
			settings: existing.settings,
			encryptedSecrets: existing.encryptedSecrets,
			approvedPermissions: ["network.external", "settings.read"],
		});
	});

	it("returns newest history entries with a bounded requested limit", async () => {
		const history = [{ pluginId: "flixer.example", outcome: "failed" }];
		const find = vi.fn().mockResolvedValue(history);
		const dataSource = {
			getRepository: vi.fn().mockReturnValue({ find }),
		} as unknown as DataSource;
		const manager = new PluginManagerService(dataSource, {} as IndexerClient);

		await expect(manager.updateHistory("flixer.example", 10)).resolves.toBe(history);
		expect(find).toHaveBeenCalledWith({
			where: { pluginId: "flixer.example" },
			order: { createdAt: "DESC" },
			take: 10,
		});
		await expect(manager.updateHistory("flixer.example", 101)).rejects.toThrow("between 1 and 100");
		await expect(manager.updateHistory("../outside")).rejects.toThrow("not found");
	});
});
