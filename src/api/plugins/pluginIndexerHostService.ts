import { Inject, Injectable } from "@tsed/di";
import { NotFound } from "@tsed/exceptions";
import { DataSource } from "typeorm";
import { DefaultDataSource } from "../../datasources/defaultDataSource.datasource.ts";
import { PluginInstallation } from "../../entities/pluginInstallation.entity.ts";
import { executeHostCalls, type HttpRequest } from "./pluginHostCalls.ts";
import { PluginSettingsService } from "./pluginSettingsService.ts";

@Injectable()
export class PluginIndexerHostService {
	constructor(@Inject(DefaultDataSource) private readonly dataSource: DataSource, private readonly settings: PluginSettingsService) {}

	httpGet: HttpRequest | undefined;

	async execute(pluginId: string, calls: unknown) {
		const installation = await this.dataSource.getRepository(PluginInstallation).findOneBy({ pluginId });
		if (!installation?.enabled || !installation.manifest.targets["flixer-indexer"] || !installation.manifest.capabilities.some((capability) => capability.startsWith("indexer.provider."))) {
			throw new NotFound("Indexer plugin not found.");
		}
		const approved = new Set(installation.approvedPermissions.filter((permission) => installation.manifest.permissions.includes(permission)));
		return executeHostCalls(calls, approved, this.httpGet, async (call) => {
			if (call.op !== "settings.get") return { id: call.id, ok: false, error: "invalid_request" };
			if (!approved.has("settings.read")) return { id: call.id, ok: false, error: "permission_denied" };
			try {
				return { id: call.id, ok: true, settings: await this.settings.effectiveValues(installation) };
			} catch {
				return { id: call.id, ok: false, error: "request_failed" };
			}
		});
	}
}