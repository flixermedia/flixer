import { describe, expect, it, vi } from "vitest";
import type { DataSource } from "typeorm";
import type { IndexerClient } from "../indexer/indexerClient.js";
import type { PluginStorageService } from "./pluginStorageService.js";
import { PluginWasiRuntime } from "./pluginWasiRuntime.js";

function setup(
	response: unknown = { result: { ok: true } },
	enabled = true,
	capabilities = ["api.routes"],
	permissions = ["api.routes.request"],
	approvedPermissions = permissions,
) {
	const installation = {
		enabled,
		manifest: { targets: { flixer: { entry: "backend.wasm" } }, capabilities, permissions },
		approvedPermissions,
		status: "enabled",
		lastError: null as string | null,
		targetStatus: { flixer: "requested" },
	};
	const save = vi.fn(async (value: typeof installation) => value);
	const findOneBy = vi.fn(async () => installation);
	const indexerRequest = vi.fn(async () => response);
	const storageLoad = vi.fn(async () => ({}));
	const storageSave = vi.fn(async () => undefined);
	const dataSource = {
		getRepository: () => ({ findOneBy, save }),
	} as unknown as DataSource;
	const indexer = { request: indexerRequest } as unknown as IndexerClient;
	return {
		installation,
		findOneBy,
		indexerRequest,
		storageLoad,
		storageSave,
		runtime: new PluginWasiRuntime(dataSource, indexer, {
			load: storageLoad,
			save: storageSave,
		} as unknown as PluginStorageService),
	};
}

describe("PluginWasiRuntime", () => {
	it("dispatches an authenticated, bounded backend operation through the signed indexer client", async () => {
		const { installation, indexerRequest, runtime } = setup();

		await expect(
			runtime.invoke("flixer.example", "request", { id: "user-1", role: "user" }, { title: "Example" }),
		).resolves.toEqual({ ok: true });
		expect(indexerRequest).toHaveBeenCalledWith("POST", "/internal/plugins/invoke", {
			body: {
				pluginId: "flixer.example",
				input: {
					apiVersion: 1,
					method: "request",
					operation: "request",
					user: { id: "user-1", role: "user" },
					request: { method: "POST", body: { title: "Example" } },
				},
			},
			timeoutMs: 8_000,
		});
		expect(installation.status).toBe("running");
		expect(installation.targetStatus.flixer).toBe("running");
	});

	it("does not dispatch disabled plugins or plugins without backend route capability", async () => {
		const disabled = setup(undefined, false);
		await expect(
			disabled.runtime.invoke("flixer.example", "request", { id: "user-1", role: "user" }, {}),
		).rejects.toThrow("not found");
		expect(disabled.indexerRequest).not.toHaveBeenCalled();

		const unsupported = setup(undefined, true, ["indexer.provider.movie"]);
		await expect(
			unsupported.runtime.invoke("flixer.example", "request", { id: "user-1", role: "user" }, {}),
		).rejects.toThrow("not found");
		expect(unsupported.indexerRequest).not.toHaveBeenCalled();
	});

	it("requires an explicitly approved permission for each operation", async () => {
		const denied = setup({ result: { ok: true } }, true, ["api.routes"], ["api.routes.request"], []);
		await expect(
			denied.runtime.invoke("flixer.example", "request", { id: "user-1", role: "user" }, {}),
		).rejects.toThrow("not found");
		expect(denied.indexerRequest).not.toHaveBeenCalled();
	});

	it("supplies only granted storage and persists plugin-returned storage", async () => {
		const permissions = ["api.routes.request", "storage.plugin.read", "storage.plugin.write"];
		const { indexerRequest, runtime, storageLoad, storageSave } = setup(
			{ result: { ok: true }, storage: { plugin: { set: { theme: "dark" } } } },
			true,
			["api.routes"],
			permissions,
		);
		storageLoad.mockResolvedValue({ plugin: { theme: "light" } });

		await expect(runtime.invoke("flixer.example", "request", { id: "user-1", role: "user" }, {})).resolves.toEqual({
			ok: true,
		});
		expect(indexerRequest).toHaveBeenCalledWith(
			"POST",
			"/internal/plugins/invoke",
			expect.objectContaining({
				body: expect.objectContaining({
					input: expect.objectContaining({ storage: { plugin: { theme: "light" } } }),
				}),
			}),
		);
		expect(storageSave).toHaveBeenCalledWith(
			"flixer.example",
			"user-1",
			{ plugin: { set: { theme: "dark" } } },
			new Set(permissions),
		);
	});

	it("rejects oversized requests and records isolated runtime failures", async () => {
		const oversized = setup();
		await expect(
			oversized.runtime.invoke(
				"flixer.example",
				"request",
				{ id: "user-1", role: "user" },
				"x".repeat(1024 * 1024),
			),
		).rejects.toThrow("size limit");
		expect(oversized.indexerRequest).not.toHaveBeenCalled();

		const failing = setup({ error: { code: "failed", message: "private details" } });
		await expect(
			failing.runtime.invoke("flixer.example", "request", { id: "user-1", role: "user" }, {}),
		).rejects.toThrow("could not complete");
		expect(failing.installation.status).toBe("error");
		expect(failing.installation.lastError).toBe("Plugin invocation failed.");
		expect(failing.installation.targetStatus.flixer).toBe("error");
	});
});
