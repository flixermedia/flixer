import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DataSource } from "typeorm";
import { PluginSlotService } from "./pluginSlotService.js";

describe("PluginSlotService", () => {
	afterEach(() => vi.unstubAllEnvs());

	it("requires an enabled plugin and current grants for player control", async () => {
		const installation = { manifest: { targets: { "flixer-web": { entry: "slot.js" } }, capabilities: ["ui.slots"], permissions: ["ui.slot.player.controls", "ui.player.control"], ui: { slots: [{ id: "control", location: "player.controls", adminOnly: true }] } }, approvedPermissions: ["ui.slot.player.controls", "ui.player.control"] };
		const repository = { findOneBy: vi.fn().mockResolvedValue(installation) };
		const service = new PluginSlotService({ getRepository: () => repository } as unknown as DataSource);
		await expect(service.canControl("plugin.example", "control", "user")).resolves.toBe(false);
		await expect(service.canControl("plugin.example", "control", "admin")).resolves.toBe(true);
		expect(repository.findOneBy).toHaveBeenCalledWith({ pluginId: "plugin.example", enabled: true });
		installation.approvedPermissions = ["ui.slot.player.controls"];
		await expect(service.canControl("plugin.example", "control", "admin")).resolves.toBe(false);
	});

	it("returns only approved visible slots and rejects entries outside the package", async () => {
		const root = await mkdtemp(join(tmpdir(), "flixer-slot-"));
		try {
			vi.stubEnv("DATA_PATH", root);
			const directory = join(root, "plugins", "installed", "plugin.example");
			await mkdir(directory, { recursive: true });
			await writeFile(join(directory, "slot.js"), "document.body.textContent = 'ready'");
			const installation = { pluginId: "plugin.example", enabled: true, status: "enabled", lastError: null, targetStatus: { "flixer-web": "requested" }, manifest: { targets: { "flixer-web": { entry: "slot.js" } }, capabilities: ["ui.slots"], permissions: ["ui.slot.media.detail"], ui: { slots: [{ id: "detail", title: "Details", location: "media.detail" }, { id: "admin", title: "Admin", location: "media.detail", adminOnly: true }] } }, approvedPermissions: ["ui.slot.media.detail"] };
			const dataSource = { getRepository: vi.fn(() => ({ find: vi.fn().mockResolvedValue([installation]), update: vi.fn().mockResolvedValue({ affected: 1 }) })) } as unknown as DataSource;
			const service = new PluginSlotService(dataSource);
			const visible = await service.list("user", "media.detail");
			expect(visible).toHaveLength(1);
			expect(installation.targetStatus["flixer-web"]).toBe("running");
			expect(Buffer.from(visible[0].source, "base64").toString()).toContain("ready");
			expect(await service.list("admin", "media.detail")).toHaveLength(2);
			installation.approvedPermissions = [];
			expect(await service.list("admin", "media.detail")).toEqual([]);
			installation.approvedPermissions = ["ui.slot.media.detail"];
			await writeFile(join(root, "outside.js"), "secret");
			await symlink(join(root, "outside.js"), join(directory, "outside.js"));
			installation.manifest.targets["flixer-web"].entry = "outside.js";
			expect(await service.list("admin", "media.detail")).toEqual([]);
			expect(installation.targetStatus["flixer-web"]).toBe("error");
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});