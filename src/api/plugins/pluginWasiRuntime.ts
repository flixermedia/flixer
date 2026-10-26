import { BadRequest, Exception, NotFound } from "@tsed/exceptions";
import { Inject, Injectable, logger } from "@tsed/di";
import { DataSource } from "typeorm";
import { DefaultDataSource } from "../../datasources/defaultDataSource.datasource.js";
import { PluginInstallation } from "../../entities/pluginInstallation.entity.js";
import { IndexerClient } from "../indexer/indexerClient.js";
import { PluginStorageService } from "./pluginStorageService.js";

const MAX_REQUEST_BYTES = 1024 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

@Injectable()
export class PluginWasiRuntime {
	constructor(
		@Inject(DefaultDataSource) private readonly dataSource: DataSource,
		private readonly indexer: IndexerClient,
		private readonly storage: PluginStorageService,
	) {}

	async invoke(
		pluginId: string,
		operation: string,
		user: { id: string; role: string },
		request: unknown,
	): Promise<unknown> {
		if (!/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(pluginId)) throw new NotFound("Plugin endpoint not found.");
		if (!/^[a-z][a-z0-9-]{0,63}$/.test(operation)) throw new BadRequest("Plugin operation name is invalid.");
		const installations = this.dataSource.getRepository(PluginInstallation);
		const installation = await installations.findOneBy({ pluginId });
		if (
			!installation?.enabled ||
			!installation.manifest.targets.flixer ||
			!installation.manifest.capabilities.some(
				(capability) => capability === "api.routes" || capability === "backend.routes",
			)
		) {
			throw new NotFound("Plugin endpoint not found.");
		}
		const routePermission = `api.routes.${operation}`;
		if (
			!installation.manifest.permissions.includes(routePermission) ||
			!installation.approvedPermissions.includes(routePermission)
		) {
			throw new NotFound("Plugin endpoint not found.");
		}

		const approvedPermissions = new Set(
			installation.approvedPermissions.filter((permission) =>
				installation.manifest.permissions.includes(permission),
			),
		);
		const storage = await this.storage.load(pluginId, user.id, approvedPermissions);
		const input = {
			apiVersion: 1,
			method: operation,
			operation,
			user: { id: user.id, role: user.role },
			request: { method: "POST", body: request },
			...(Object.keys(storage).length > 0 ? { storage } : {}),
		};
		if (Buffer.byteLength(JSON.stringify(input)) > MAX_REQUEST_BYTES) {
			throw new BadRequest("Plugin request exceeds the size limit.");
		}

		try {
			const response: unknown = await this.indexer.request("POST", "/internal/plugins/invoke", {
				body: { pluginId, input },
				timeoutMs: 8_000,
			});
			if (!isRecord(response)) throw new Error("Plugin returned an invalid response.");
			if (isRecord(response.error)) throw new Error("Plugin reported an execution error.");
			if (!Object.hasOwn(response, "result")) throw new Error("Plugin response is missing its result.");
			if (Object.hasOwn(response, "storage")) {
				await this.storage.save(pluginId, user.id, response.storage, approvedPermissions);
			}
			installation.status = "running";
			installation.lastError = null;
			installation.targetStatus = { ...installation.targetStatus, flixer: "running" };
			await installations.save(installation);
			return response.result;
		} catch (error: unknown) {
			installation.status = "error";
			installation.lastError = "Plugin invocation failed.";
			installation.targetStatus = { ...installation.targetStatus, flixer: "error" };
			await installations.save(installation);
			logger().error(`Backend plugin ${pluginId} invocation failed.`, error);
			throw new Exception(502, `Plugin ${pluginId} could not complete this operation.`);
		}
	}
}
