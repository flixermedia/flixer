import { afterEach, describe, expect, it, vi } from "vitest";
import type { DataSource } from "typeorm";
import type { IndexerClient } from "../indexer/indexerClient.js";
import type { PluginManifest } from "./pluginManifest.js";
import * as repositoryClient from "./pluginRepositoryClient.js";
import {
	PluginManagerService,
	pluginUpdateErrorMessage,
	preservePluginInstallationState,
} from "./pluginManagerService.js";

afterEach(() => vi.unstubAllEnvs());

describe("pluginUpdateErrorMessage", () => {
	it("fetches only declared repository images and validates their contents", async () => {
		const repository = { id: "f9ff03b6-6b69-4c73-b9f0-40f4db373a25", enabled: true, url: "https://example.com/repository.json", manifest: { plugins: [{ icon: "images/logo.png" }] } };
		const dataSource = { getRepository: vi.fn(() => ({ findOneBy: vi.fn().mockResolvedValue(repository) })) } as unknown as DataSource;
		const manager = new PluginManagerService(dataSource, {} as IndexerClient);
		const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
		const fetch = vi.spyOn(repositoryClient, "fetchPluginRepositoryArtifact").mockResolvedValue(png);
		await expect(manager.repositoryImage(repository.id, "images/logo.png")).resolves.toEqual({ data: png, mime: "image/png" });
		expect(fetch).toHaveBeenCalledWith(repository.url, "images/logo.png", 5 * 1024 * 1024, "image/png, image/jpeg, image/webp, image/gif");
		await expect(manager.repositoryImage(repository.id, "images/other.png")).rejects.toThrow("not found");
		await expect(manager.repositoryImage(repository.id, "../logo.png")).rejects.toThrow("not found");
		fetch.mockResolvedValueOnce(Buffer.from("not an image"));
		await expect(manager.repositoryImage(repository.id, "images/logo.png")).rejects.toThrow("not a supported image");
		fetch.mockRestore();
	});

	it("keeps local imports disabled unless the explicit environment flag is true", async () => {
		const manager = new PluginManagerService({} as DataSource, {} as IndexerClient);
		vi.stubEnv("FLIXER_PLUGIN_LOCAL_IMPORTS", "false");
		expect(manager.localImportEnabled()).toBe(false);
		await expect(manager.inspectLocalPackage(Buffer.from("archive"))).rejects.toThrow("disabled");
		vi.stubEnv("FLIXER_PLUGIN_LOCAL_IMPORTS", "true");
		expect(manager.localImportEnabled()).toBe(true);
	});

	it("requires exact explicit approval for every local package permission", async () => {
		vi.stubEnv("FLIXER_PLUGIN_LOCAL_IMPORTS", "true");
		const manager = new PluginManagerService({} as DataSource, {} as IndexerClient);
		vi.spyOn(manager, "inspectLocalPackage").mockResolvedValue({
			manifestVersion: 1,
			id: "example.github-oauth",
			name: "GitHub OAuth",
			version: "0.1.0",
			description: "Test provider",
			author: "Flixer",
			license: "MIT",
			compatibility: { pluginApi: "^1.0.0" },
			targets: { flixer: { entry: "github-oauth.wasm" } },
			capabilities: ["auth.oauth"],
			permissions: ["auth.identity.verify", "network.http.github.com"],
		});
		await expect(manager.importLocalPackage(Buffer.from("archive"), ["auth.identity.verify"])).rejects.toThrow("Explicit approval");
		await expect(manager.importLocalPackage(Buffer.from("archive"), ["auth.identity.verify", "network.http.github.com", "extra.permission"])).rejects.toThrow("Explicit approval");
	});

	it("requires explicit slot grants and a safe JavaScript entry", () => {
		const manager = new PluginManagerService({} as DataSource, {} as IndexerClient);
		const check = manager as unknown as { activationProblem: (manifest: PluginManifest) => string | null };
		const manifest = { manifestVersion: 1, id: "plugin.example", name: "Example", version: "1.0.0", description: "Example", author: "Example", license: "MIT", compatibility: { pluginApi: "^1.0.0" }, targets: { "flixer-web": { entry: "web/slot.js" } }, capabilities: ["ui.slots"], permissions: ["ui.slot.media.detail"], ui: { slots: [{ id: "detail", title: "Detail", location: "media.detail" }] } } as PluginManifest;
		expect(check.activationProblem(manifest)).toBeNull();
		expect(check.activationProblem({ ...manifest, permissions: [] })).toContain("permission");
		expect(check.activationProblem({ ...manifest, targets: { "flixer-web": { entry: "web/slot.html" } } })).toContain("JavaScript");
	});

	it("keeps a failed backend visible when the indexer target is healthy", async () => {
		const installation = {
			pluginId: "flixer.example", enabled: true, status: "enabled", lastError: null,
			targetStatus: { flixer: "requested", "flixer-indexer": "requested" },
			manifest: { targets: { flixer: { entry: "backend.wasm" }, "flixer-indexer": { entry: "indexer.wasm" } } },
		};
		const repository = { find: vi.fn().mockResolvedValue([installation]), update: vi.fn().mockResolvedValue({ affected: 1 }) };
		const dataSource = { getRepository: vi.fn(() => repository) } as unknown as DataSource;
		const indexer = { pluginStatuses: vi.fn().mockResolvedValue([{ id: "flixer.example", state: "registered", targets: { flixer: { state: "error", error: "Backend unavailable." }, "flixer-indexer": { state: "registered" } } }]) } as unknown as IndexerClient;
		const manager = new PluginManagerService(dataSource, indexer);
		await (manager as unknown as { refreshPluginHealth: () => Promise<void> }).refreshPluginHealth();
		expect(installation).toMatchObject({ enabled: true, status: "error", targetStatus: { flixer: "error", "flixer-indexer": "running" } });
		expect(repository.update).toHaveBeenCalledWith({ pluginId: "flixer.example", enabled: true }, expect.not.objectContaining({ enabled: true }));
	});

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
