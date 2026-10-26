import { describe, expect, it } from "vitest";
import { parsePluginRepositoryManifest, pluginCatalogMatchesManifest } from "./repositoryManifest.js";

const validCatalog = {
	manifestVersion: 1,
	id: "flixer.official",
	name: "Official Flixer Plugins",
	description: "Official extensions maintained by Flixer.",
	plugins: [
		{
			id: "flixer.example",
			name: "Example Plugin",
			description: "An example plugin.",
			author: "Flixer",
			capabilities: ["web.settings"],
			permissions: ["settings.read"],
			targets: ["flixer", "flixer-web"],
			versions: [
				{
				version: "1.0.0",
				manifest: "plugins/example/1.0.0/plugin.json",
				package: "plugins/example/1.0.0/plugin.tar.gz",
				sha256: "a".repeat(64),
				size: 1024,
			},
			],
		},
	],
};

describe("parsePluginRepositoryManifest", () => {
	it("accepts independently versioned plugin releases", () => {
		expect(parsePluginRepositoryManifest(validCatalog)).toEqual(validCatalog);
	});

	it("rejects unsafe artifact paths and invalid digests", () => {
		expect(() =>
			parsePluginRepositoryManifest({
				...validCatalog,
				plugins: [{ ...validCatalog.plugins[0], versions: [{ ...validCatalog.plugins[0].versions[0], package: "../plugin.tar.gz" }] }],
			}),
		).toThrow("Invalid plugin repository manifest");
		expect(() =>
			parsePluginRepositoryManifest({
				...validCatalog,
				plugins: [{ ...validCatalog.plugins[0], versions: [{ ...validCatalog.plugins[0].versions[0], sha256: "bad" }] }],
			}),
		).toThrow("Invalid plugin repository manifest");
	});

	it("rejects duplicate plugin IDs and versions", () => {
		expect(() => parsePluginRepositoryManifest({ ...validCatalog, plugins: [...validCatalog.plugins, ...validCatalog.plugins] })).toThrow(
			"duplicate plugin id",
		);
		const plugin = validCatalog.plugins[0];
		expect(() =>
			parsePluginRepositoryManifest({
				...validCatalog,
				plugins: [{ ...plugin, versions: [...plugin.versions, ...plugin.versions] }],
			}),
		).toThrow("duplicate version");
	});
});

describe("pluginCatalogMatchesManifest", () => {
	it("requires release identity, targets, capabilities, and permissions to match", () => {
		const catalogEntry = validCatalog.plugins[0]!;
		const manifest = {
			manifestVersion: 1 as const,
			id: catalogEntry.id,
			name: catalogEntry.name,
			version: "1.0.0",
			description: catalogEntry.description,
			author: catalogEntry.author,
			license: "MIT",
			compatibility: { pluginApi: "^1.0.0" },
			targets: { flixer: { entry: "backend/plugin.wasm" }, "flixer-web": { entry: "web/index.html" } },
			capabilities: catalogEntry.capabilities ?? [],
			permissions: catalogEntry.permissions,
		};
		expect(pluginCatalogMatchesManifest(catalogEntry, manifest)).toBe(true);
		expect(pluginCatalogMatchesManifest({ ...catalogEntry, permissions: [] }, manifest)).toBe(false);
		expect(pluginCatalogMatchesManifest({ ...catalogEntry, targets: ["flixer"] }, manifest)).toBe(false);
	});
});