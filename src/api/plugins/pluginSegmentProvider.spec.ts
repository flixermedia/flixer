import { describe, expect, it, vi } from "vitest";
import type { DataSource } from "typeorm";
import { PluginSegmentProvider } from "./pluginSegmentProvider.js";
import type { PluginWasiRuntime } from "./pluginWasiRuntime.js";

const item = { type: "movie" as const, durationMs: 1000, providerIds: { tmdb: "1" } };

function setup(overrides: Record<string, unknown> = {}, execute = vi.fn()) {
	const installation = {
		pluginId: "flixer.skipmedb",
		enabled: true,
		manifest: { targets: { flixer: {} }, capabilities: ["media.segments"], permissions: ["media.segments.lookup"] },
		approvedPermissions: ["media.segments.lookup"],
		...overrides,
	};
	const dataSource = {
		getRepository: () => ({
			findBy: async (where: { enabled: boolean }) =>
				installation.enabled === where.enabled ? [installation] : [],
		}),
	} as unknown as DataSource;
	return { execute, provider: new PluginSegmentProvider(dataSource, { execute } as unknown as PluginWasiRuntime) };
}

describe("PluginSegmentProvider", () => {
	it("reports no provider unless a plugin has the capability and the approved permission", async () => {
		for (const overrides of [{ approvedPermissions: [] }, { enabled: false }]) {
			const { provider, execute } = setup(overrides);
			await expect(provider.lookup(item, { baseUrl: "https://x" })).resolves.toEqual({ status: "no-provider" });
			expect(execute).not.toHaveBeenCalled();
		}
	});

	it("returns validated segments and keeps explicit nulls", async () => {
		const execute = vi.fn(async () => ({
			segments: {
				intro: { startMs: 1, endMs: 9, submissions: 2 },
				recap: null,
				credits: { startMs: 9, endMs: 3, submissions: 1 },
				preview: "bad",
			},
		}));
		const { provider } = setup({}, execute);

		await expect(provider.lookup(item, { baseUrl: "https://x" })).resolves.toEqual({
			status: "ok",
			segments: { intro: { startMs: 1, endMs: 9, submissions: 2 }, recap: null },
		});
		expect(execute).toHaveBeenCalledWith(
			expect.anything(),
			"lookup",
			{ id: "system", role: "system" },
			{ item, baseUrl: "https://x" },
		);
	});

	it("reports failure when the plugin errors", async () => {
		const { provider } = setup({}, vi.fn().mockRejectedValue(new Error("boom")));
		await expect(provider.lookup(item, { baseUrl: "https://x" })).resolves.toEqual({ status: "failed" });
	});
});
