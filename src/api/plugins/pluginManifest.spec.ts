import { describe, expect, it } from "vitest";
import { parsePluginManifest } from "./pluginManifest.js";

const validManifest = {
	manifestVersion: 1,
	id: "flixer.example",
	name: "Example Plugin",
	version: "1.2.3",
	description: "A plugin targeting the backend and web app.",
	author: "Flixer",
	license: "MIT",
	compatibility: { pluginApi: "^1.0.0" },
	targets: {
		flixer: { entry: "backend/plugin.wasm" },
		"flixer-web": { entry: "web/index.html" },
	},
	capabilities: ["web.settings"],
	permissions: ["settings.read"],
};

describe("parsePluginManifest", () => {
	it("accepts a valid multi-target manifest", () => {
		expect(parsePluginManifest(validManifest)).toEqual(validManifest);
	});

	it("accepts admin pages and rejects unknown sections", () => {
		const page = { id: "skipmedb", title: "SkipMe.db", section: "providers" };
		const ui = { adminPages: [page] };
		expect(parsePluginManifest({ ...validManifest, ui }).ui).toEqual(ui);
		expect(() => parsePluginManifest({ ...validManifest, ui: { adminPages: [{ ...page, section: "x" }] } })).toThrow();
	});

	it.each(["../plugin.wasm", "/plugin.wasm", "backend\\plugin.wasm"])("rejects unsafe entry paths: %s", (entry) => {
		const manifest = {
			...validManifest,
			targets: { flixer: { entry } },
		};

		expect(() => parsePluginManifest(manifest)).toThrow("Invalid plugin manifest");
	});

	it("rejects unsupported targets and malformed versions", () => {
		expect(() => parsePluginManifest({ ...validManifest, version: "v1" })).toThrow("Invalid plugin manifest");
		expect(() =>
			parsePluginManifest({
				...validManifest,
				targets: { "flixer-admin": { entry: "backend/plugin.wasm" } },
			}),
		).toThrow("Invalid plugin manifest");
	});
});