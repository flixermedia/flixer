import { describe, expect, it } from "vitest";
import { parsePluginManifest, updatePluginTargetHealth } from "./pluginManifest.js";

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
	it("keeps a plugin degraded while any target remains unavailable", () => {
		const installation = { status: "enabled" as const, lastError: null as string | null, targetStatus: { flixer: "requested", "flixer-indexer": "requested" } };
		updatePluginTargetHealth(installation, "flixer", "error", "Backend failed.");
		updatePluginTargetHealth(installation, "flixer-indexer", "running");
		expect(installation).toMatchObject({ status: "error", targetStatus: { flixer: "error", "flixer-indexer": "running" } });
		updatePluginTargetHealth(installation, "flixer", "running");
		expect(installation).toMatchObject({ status: "running", lastError: null });
	});
	it("accepts a valid multi-target manifest", () => {
		expect(parsePluginManifest(validManifest)).toEqual(validManifest);
	});

	it("accepts supported custom UI slots and rejects unknown locations", () => {
		const slot = { id: "details", title: "Details", location: "media.detail" };
		expect(parsePluginManifest({ ...validManifest, ui: { slots: [slot] } }).ui?.slots).toEqual([slot]);
		expect(() => parsePluginManifest({ ...validManifest, ui: { slots: [{ ...slot, location: "unsupported" }] } })).toThrow("Invalid plugin manifest");
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