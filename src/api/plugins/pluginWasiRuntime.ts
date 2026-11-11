import { BadRequest, Exception, NotFound } from "@tsed/exceptions";
import { Inject, Injectable, logger } from "@tsed/di";
import { DataSource } from "typeorm";
import { DefaultDataSource } from "../../datasources/defaultDataSource.datasource.js";
import { PluginInstallation } from "../../entities/pluginInstallation.entity.js";
import { IndexerClient } from "../indexer/indexerClient.js";
import { executeHostCalls, MAX_HOST_CALL_ROUNDS, publicHttpsGet, type HttpRequest } from "./pluginHostCalls.js";
import { PluginHostService } from "./pluginHostService.js";
import { PluginSettingsService } from "./pluginSettingsService.js";
import { updatePluginTargetHealth } from "./pluginManifest.js";
import { executeDirectoryBind, executeDirectorySearch } from "./pluginDirectoryHost.js";
import { PluginStorageService } from "./pluginStorageService.js";

const MAX_REQUEST_BYTES = 1024 * 1024;

export interface OAuthRuntimeProfile {
	settings: Record<string, string>;
	tokenUrl: string;
	userInfoUrl: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

@Injectable()
export class PluginWasiRuntime {
	constructor(
		@Inject(DefaultDataSource) private readonly dataSource: DataSource,
		private readonly indexer: IndexerClient,
		private readonly storage: PluginStorageService,
		private readonly host: PluginHostService,
		private readonly settings: PluginSettingsService,
	) {}

	/** Overridable in tests; production uses the pinned public HTTPS client. */
	httpGet: HttpRequest | undefined;

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

		return this.execute(installation, operation, user, request);
	}

	/** Runs an already-authorised operation; callers must have verified enablement, target and permissions. */
	async execute(
		installation: PluginInstallation,
		operation: string,
		user: { id: string; role: string },
		request: unknown,
		target: "flixer" | "flixer-streamer" = "flixer",
		mode: "standard" | "authentication" = "standard",
		oauthProfile?: OAuthRuntimeProfile,
	): Promise<unknown> {
		const pluginId = installation.pluginId;
		if (oauthProfile && (mode !== "authentication" || !installation.manifest.capabilities.includes("auth.oauth.profiles") || !installation.manifest.permissions.includes("network.http.configured") || !installation.approvedPermissions.includes("network.http.configured"))) throw new BadRequest("Configured OAuth endpoints are not approved.");
		const installations = this.dataSource.getRepository(PluginInstallation);
		const approvedPermissions = new Set(
			installation.approvedPermissions.filter((permission) =>
				installation.manifest.permissions.includes(permission) && (mode !== "authentication" || permission === "settings.read" || permission === "directory.search" || permission.startsWith("network.ldaps.") || (permission.startsWith("network.http.") && permission !== "network.http.any")),
			),
		);
		if (oauthProfile) {
			for (const endpoint of [oauthProfile.tokenUrl, oauthProfile.userInfoUrl]) approvedPermissions.add(`network.http.${new URL(endpoint).hostname.toLowerCase()}`);
		}
		const storage = await this.storage.load(pluginId, user.id, approvedPermissions);
		const settings = oauthProfile?.settings ?? (approvedPermissions.has("settings.read") ? await this.settings.effectiveValues(installation) : null);
		const httpRequest: HttpRequest | undefined = oauthProfile ? async (url, options) => {
			const method = options?.method ?? (options?.body === undefined ? "GET" : "POST");
			if (!((url.toString() === oauthProfile.tokenUrl && method === "POST") || (url.toString() === oauthProfile.userInfoUrl && method === "GET"))) throw new Error("OAuth endpoint is not approved.");
			return (this.httpGet ?? publicHttpsGet)(url, options);
		} : this.httpGet;
		const input = {
			apiVersion: 1,
			method: operation,
			operation,
			now: new Date().toISOString(),
			user: { id: user.id, role: user.role },
			request: { method: "POST", body: request },
			...(Object.keys(storage).length > 0 ? { storage } : {}),
			...(settings ? { settings } : {}),
		};
		if (Buffer.byteLength(JSON.stringify(input)) > MAX_REQUEST_BYTES) {
			throw new BadRequest("Plugin request exceeds the size limit.");
		}

		try {
			let response = await this.call(pluginId, input, target);
			for (let round = 0; isRecord(response) && Object.hasOwn(response, "hostCalls"); round++) {
				if (round >= MAX_HOST_CALL_ROUNDS) throw new Error("Plugin exceeded the host call limit.");
				const hostResults = await executeHostCalls(response.hostCalls, approvedPermissions, httpRequest, (call) => {
					if (mode === "authentication" && call.op === "ldap.bind") return executeDirectoryBind(call, approvedPermissions, isRecord(request) ? request.password : undefined);
					if (mode === "authentication" && call.op === "ldap.search") return executeDirectorySearch(call, approvedPermissions);
					return this.host.handle(installation, approvedPermissions, call);
				});
				response = await this.call(pluginId, {
					...input,
					continuation: response.continuation ?? null,
					hostResults,
				}, target);
			}
			if (!isRecord(response)) throw new Error("Plugin returned an invalid response.");
			if (isRecord(response.error)) throw new Error("Plugin reported an execution error.");
			if (!Object.hasOwn(response, "result")) throw new Error("Plugin response is missing its result.");
			if (Object.hasOwn(response, "storage")) {
				await this.storage.save(pluginId, user.id, response.storage, approvedPermissions);
			}
			updatePluginTargetHealth(installation, target, "running");
			await installations.update({ pluginId, enabled: true }, { status: installation.status, lastError: installation.lastError, targetStatus: installation.targetStatus });
			return response.result;
		} catch (error: unknown) {
			updatePluginTargetHealth(installation, target, "error", "Plugin invocation failed.");
			await installations.update({ pluginId, enabled: true }, { status: installation.status, lastError: installation.lastError, targetStatus: installation.targetStatus });
			if (mode === "authentication") logger().error(`Authentication plugin ${pluginId} invocation failed.`);
			else logger().error(`Backend plugin ${pluginId} invocation failed.`, error);
			throw new Exception(502, `Plugin ${pluginId} could not complete this operation.`);
		}
	}

	private async call(pluginId: string, input: Record<string, unknown>, target: "flixer" | "flixer-streamer"): Promise<unknown> {
		if (Buffer.byteLength(JSON.stringify(input)) > MAX_REQUEST_BYTES) {
			throw new Error("Plugin request exceeds the size limit.");
		}
		return this.indexer.request("POST", "/internal/plugins/invoke", {
			body: { pluginId, input, ...(target === "flixer-streamer" ? { target } : {}) },
			timeoutMs: 8_000,
		});
	}
}
