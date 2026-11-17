import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { Inject, Injectable, logger } from "@tsed/di";
import { BadRequest } from "@tsed/exceptions";
import { DataSource } from "typeorm";
import { dataPath } from "../../config/dataPath.js";
import { DefaultDataSource } from "../../datasources/defaultDataSource.datasource.js";
import { PluginInstallation } from "../../entities/pluginInstallation.entity.js";
import { updatePluginTargetHealth } from "./pluginManifest.js";

const MAX_SOURCE_BYTES = 256 * 1024;
const LOCATIONS = ["media.detail", "player.controls"] as const;

@Injectable()
export class PluginSlotService {
	constructor(@Inject(DefaultDataSource) private readonly dataSource: DataSource) {}

	async canControl(pluginId: string, slotId: string, role: string): Promise<boolean> {
		const installation = await this.dataSource.getRepository(PluginInstallation).findOneBy({ pluginId, enabled: true });
		if (!installation?.manifest.targets["flixer-web"] || !installation.manifest.capabilities.includes("ui.slots")) return false;
		const required = ["ui.slot.player.controls", "ui.player.control"];
		if (!required.every((permission) => installation.manifest.permissions.includes(permission) && installation.approvedPermissions.includes(permission))) return false;
		return (installation.manifest.ui?.slots ?? []).some((slot) => slot.id === slotId && slot.location === "player.controls" && (!slot.adminOnly || role === "admin"));
	}

	async list(role: string, location: string) {
		if (!(LOCATIONS as readonly string[]).includes(location)) throw new BadRequest("Unknown plugin slot location.");
		const repository = this.dataSource.getRepository(PluginInstallation);
		const installations = await repository.find({ where: { enabled: true }, order: { pluginId: "ASC" } });
		const slots: Array<{ pluginId: string; id: string; title: string; source: string; playbackControl: boolean }> = [];
		for (const installation of installations) {
			const { manifest, approvedPermissions } = installation;
			const entry = manifest.targets["flixer-web"]?.entry;
			const permission = `ui.slot.${location}`;
			if (!entry || !manifest.capabilities.includes("ui.slots") || !manifest.permissions.includes(permission) || !approvedPermissions.includes(permission)) continue;
			const visible = (manifest.ui?.slots ?? []).filter((slot) => slot.location === location && (!slot.adminOnly || role === "admin"));
			if (!visible.length) continue;
			try {
				const source = await this.readSource(installation.pluginId, entry);
				if (installation.targetStatus["flixer-web"] !== "running") {
					updatePluginTargetHealth(installation, "flixer-web", "running");
					await repository.update({ pluginId: installation.pluginId, enabled: true }, { status: installation.status, lastError: installation.lastError, targetStatus: installation.targetStatus });
				}
				const playbackControl = manifest.permissions.includes("ui.player.control") && approvedPermissions.includes("ui.player.control");
				for (const slot of visible) slots.push({ pluginId: installation.pluginId, id: slot.id, title: slot.title, source, playbackControl });
			} catch {
				if (installation.targetStatus["flixer-web"] !== "error") {
					updatePluginTargetHealth(installation, "flixer-web", "error", "Web slot bundle could not be loaded.");
					await repository.update({ pluginId: installation.pluginId, enabled: true }, { status: installation.status, lastError: installation.lastError, targetStatus: installation.targetStatus });
				}
				logger().warn(`Could not load web slot bundle for plugin ${installation.pluginId}.`);
			}
		}
		return slots;
	}

	private async readSource(pluginId: string, entry: string): Promise<string> {
		if (!/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(pluginId) || !/^[A-Za-z0-9._/-]+\.js$/i.test(entry)) throw new Error("Invalid web entry.");
		const packagePath = dataPath("plugins", "installed", pluginId);
		if (!(await lstat(packagePath)).isDirectory()) throw new Error("Invalid plugin directory.");
		const root = await realpath(packagePath);
		const file = await realpath(join(root, entry));
		const path = relative(root, file);
		if (!path || path === ".." || path.startsWith(`..${sep}`)) throw new Error("Web entry escapes plugin directory.");
		const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
		try {
			const info = await handle.stat();
			if (!info.isFile() || info.size > MAX_SOURCE_BYTES) throw new Error("Invalid web bundle.");
			const source = await handle.readFile();
			if (source.length > MAX_SOURCE_BYTES) throw new Error("Web bundle too large.");
			return source.toString("base64");
		} finally {
			await handle.close();
		}
	}
}