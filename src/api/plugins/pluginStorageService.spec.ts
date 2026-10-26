import { describe, expect, it, vi } from "vitest";
import type { DataSource, EntityManager } from "typeorm";
import { PluginStorageEntry } from "../../entities/pluginStorageEntry.entity.js";
import { PluginStorageService } from "./pluginStorageService.js";

describe("PluginStorageService", () => {
	it("loads only scopes granted to this plugin and authenticated user", async () => {
		const find = vi.fn().mockResolvedValue([{ scope: "user", key: "layout", value: "compact" }]);
		const dataSource = {
			getRepository: () => ({ find }),
		} as unknown as DataSource;
		const storage = new PluginStorageService(dataSource);

		await expect(storage.load("flixer.example", "user-1", new Set(["storage.user.read"]))).resolves.toEqual({
			user: { layout: "compact" },
		});
		expect(find).toHaveBeenCalledWith({
			where: [{ pluginId: "flixer.example", scope: "user", ownerId: "user-1" }],
		});
	});

	it("applies permitted scope patches transactionally and rejects writes without the matching grant", async () => {
		const find = vi.fn().mockResolvedValue([]);
		const getRepository = vi.fn(() => ({ find }));
		const query = vi.fn().mockResolvedValue([]);
		const transaction = vi.fn(async (work: (manager: EntityManager) => Promise<void>) =>
			work({ getRepository, query } as unknown as EntityManager),
		);
		const dataSource = { transaction } as unknown as DataSource;
		const storage = new PluginStorageService(dataSource);

		await expect(
			storage.save(
				"flixer.example",
				"user-1",
				{ user: { layout: "compact" } },
				new Set(["storage.plugin.write"]),
			),
		).rejects.toThrow("approved permissions");
		expect(transaction).not.toHaveBeenCalled();

		await storage.save(
			"flixer.example",
			"user-1",
			{ plugin: { set: { theme: "dark" }, delete: ["old-theme"] } },
			new Set(["storage.plugin.write"]),
		);
		expect(transaction).toHaveBeenCalledOnce();
		expect(getRepository).toHaveBeenCalledWith(PluginStorageEntry);
		expect(query).toHaveBeenCalledWith("SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))", [
			"flixer.example:plugin",
			"flixer.example",
		]);
		expect(query).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM "plugin_storage"'), [
			"flixer.example",
			"plugin",
			"flixer.example",
			["old-theme"],
		]);
		expect(query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO "plugin_storage"'), [
			"flixer.example",
			"plugin",
			"flixer.example",
			"theme",
			'"dark"',
		]);
	});

	it("enforces the limit against the combined stored document", async () => {
		const find = vi.fn().mockResolvedValue([{ key: "existing", value: "x".repeat(250 * 1024) }]);
		const getRepository = vi.fn(() => ({ find }));
		const query = vi.fn();
		const dataSource = {
			transaction: (work: (manager: EntityManager) => Promise<void>) =>
				work({ getRepository, query } as unknown as EntityManager),
		} as unknown as DataSource;
		const storage = new PluginStorageService(dataSource);

		await expect(
			storage.save(
				"flixer.example",
				"user-1",
				{ plugin: { set: { added: "y".repeat(10 * 1024) } } },
				new Set(["storage.plugin.write"]),
			),
		).rejects.toThrow("256 KiB");
		expect(query).toHaveBeenCalledOnce();
	});

	it("rejects unsafe keys and oversized documents", async () => {
		const storage = new PluginStorageService({} as DataSource);
		await expect(
			storage.save(
				"flixer.example",
				"user-1",
				{ user: { set: { "../secret": "x" } } },
				new Set(["storage.user.write"]),
			),
		).rejects.toThrow("invalid key");
		await expect(
			storage.save(
				"flixer.example",
				"user-1",
				{ user: { set: { value: "x".repeat(256 * 1024) } } },
				new Set(["storage.user.write"]),
			),
		).rejects.toThrow("256 KiB");
	});
});
