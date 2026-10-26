import { Inject, Injectable } from "@tsed/di";
import { DataSource } from "typeorm";
import { DefaultDataSource } from "../../datasources/defaultDataSource.datasource.js";
import { PluginInstallation } from "../../entities/pluginInstallation.entity.js";

export interface PluginPageSummary {
	pluginId: string;
	id: string;
	title: string;
	nav: "main" | null;
	adminOnly: boolean;
}

@Injectable()
export class PluginPagesService {
	constructor(@Inject(DefaultDataSource) private readonly dataSource: DataSource) {}

	/** Pages of enabled plugins whose `ui.pages` capability and `api.routes.page` permission are both granted. */
	async list(role: string): Promise<PluginPageSummary[]> {
		const installations = await this.dataSource.getRepository(PluginInstallation).find({ where: { enabled: true } });
		const pages: PluginPageSummary[] = [];
		for (const installation of installations) {
			const { manifest, approvedPermissions } = installation;
			if (!manifest.targets.flixer || !manifest.capabilities.includes("ui.pages")) continue;
			if (!manifest.permissions.includes("api.routes.page") || !approvedPermissions.includes("api.routes.page")) continue;
			for (const page of manifest.ui?.pages ?? []) {
				if (page.adminOnly && role !== "admin") continue;
				pages.push({
					pluginId: installation.pluginId,
					id: page.id,
					title: page.title,
					nav: page.nav ?? null,
					adminOnly: page.adminOnly === true,
				});
			}
		}
		return pages.sort((a, b) => a.title.localeCompare(b.title));
	}
}
