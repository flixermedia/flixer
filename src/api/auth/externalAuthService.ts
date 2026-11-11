import { createHash } from "node:crypto";
import { Inject, Injectable } from "@tsed/di";
import { BadRequest, Conflict, NotFound, Unauthorized } from "@tsed/exceptions";
import { DataSource, type EntityManager } from "typeorm";
import { DefaultDataSource } from "../../datasources/defaultDataSource.datasource.js";
import { ExternalIdentity } from "../../entities/externalIdentity.entity.js";
import { ExternalOAuthProvider } from "../../entities/externalOAuthProvider.entity.js";
import { PluginInstallation } from "../../entities/pluginInstallation.entity.js";
import { User } from "../../entities/user.entity.js";
import { PluginWasiRuntime } from "../plugins/pluginWasiRuntime.js";
import { AuthService } from "./authService.js";
import { oauthProfileId, splitOAuthProfileId } from "./externalOAuthProfiles.js";

@Injectable()
export class ExternalAuthService {
	constructor(@Inject(DefaultDataSource) private readonly dataSource: DataSource, private readonly auth: AuthService, private readonly runtime: PluginWasiRuntime) {}

	async providers() {
		const plugins = await this.dataSource.getRepository(PluginInstallation).find({ where: { enabled: true }, order: { pluginId: "ASC" } });
		const providers = plugins.flatMap((plugin) => {
			const kinds: Array<{ id: string; name: string; type: "directory" | "oauth" }> = [];
			if (this.isDirectoryProvider(plugin)) kinds.push({ id: plugin.pluginId, name: plugin.manifest.name, type: "directory" });
			if (this.isOAuthProvider(plugin) && !plugin.manifest.capabilities.includes("auth.oauth.profiles")) kinds.push({ id: plugin.pluginId, name: plugin.manifest.name, type: "oauth" });
			return kinds;
		});
		const configuredPlugins = plugins.filter((plugin) => this.isOAuthProvider(plugin) && plugin.manifest.capabilities.includes("auth.oauth.profiles") && plugin.manifest.permissions.includes("network.http.configured") && plugin.approvedPermissions.includes("network.http.configured"));
		if (configuredPlugins.length) {
			const profiles = await this.dataSource.getRepository(ExternalOAuthProvider).find({ where: { enabled: true }, order: { name: "ASC" } });
			const enabled = new Set(configuredPlugins.map((plugin) => plugin.pluginId));
			for (const profile of profiles) if (enabled.has(profile.pluginId)) providers.push({ id: oauthProfileId(profile.pluginId, profile.id), name: profile.name, type: "oauth" });
		}
		return providers;
	}

	async linked(authorization?: string) {
		const { user } = await this.auth.requireAuthenticatedSession(authorization);
		const links = await this.dataSource.getRepository(ExternalIdentity).find({ where: { userId: user.id }, select: { pluginId: true, providerKey: true } });
		return [...new Set(links.map((link) => link.providerKey ? oauthProfileId(link.pluginId, link.providerKey) : link.pluginId))];
	}

	async link(pluginId: string, username: string, password: string, accountPassword: string, authorization?: string) {
		const user = await this.auth.reauthenticateUser(authorization, accountPassword);
		const identityHash = await this.verify(pluginId, username, password);
		return this.bindIdentity(pluginId, identityHash, user.id);
	}

	async bindIdentity(pluginId: string, identityHash: string, userId: string, providerKey = "", manager?: EntityManager) {
		const repository = (manager ?? this.dataSource).getRepository(ExternalIdentity);
		const existing = await repository.findOneBy({ pluginId, providerKey, identityHash });
		if (existing && existing.userId !== userId) throw new Conflict("This external identity is already linked.");
		if (!existing) {
			try {
				await repository.insert({ pluginId, providerKey, identityHash, userId });
			} catch (error) {
				if (typeof error === "object" && error !== null && "driverError" in error && (error.driverError as { code?: string })?.code === "23505") throw new Conflict("This external identity is already linked.");
				throw error;
			}
		}
		return { linked: true };
	}

	async login(pluginId: string, username: string, password: string) {
		const identityHash = await this.verify(pluginId, username, password);
		return this.loginIdentity(pluginId, identityHash);
	}

	async loginIdentity(pluginId: string, identityHash: string, providerKey = "") {
		const identity = await this.dataSource.getRepository(ExternalIdentity).findOneBy({ pluginId, providerKey, identityHash });
		const user = identity ? await this.dataSource.getRepository(User).findOneBy({ id: identity.userId }) : null;
		if (!user) throw new Unauthorized("Invalid external credentials or unlinked account.");
		return this.auth.completePrimaryAuthentication(user);
	}

	async unlink(pluginId: string, accountPassword: string, authorization?: string) {
		const user = await this.auth.reauthenticateUser(authorization, accountPassword);
		const profile = splitOAuthProfileId(pluginId);
		await this.dataSource.getRepository(ExternalIdentity).delete({ pluginId: profile?.pluginId ?? pluginId, providerKey: profile?.profileId ?? "", userId: user.id });
		return { unlinked: true };
	}

	private isDirectoryProvider(plugin: PluginInstallation): boolean {
		return Boolean(plugin.enabled && plugin.manifest.targets.flixer && plugin.manifest.capabilities.includes("auth.directory") && ["auth.identity.verify", "auth.credentials"].every((permission) => plugin.manifest.permissions.includes(permission) && plugin.approvedPermissions.includes(permission)));
	}

	isOAuthProvider(plugin: PluginInstallation): boolean {
		return Boolean(plugin.enabled && plugin.manifest.targets.flixer && (plugin.manifest.capabilities.includes("auth.oidc") || plugin.manifest.capabilities.includes("auth.oauth")) && plugin.manifest.permissions.includes("auth.identity.verify") && plugin.approvedPermissions.includes("auth.identity.verify"));
	}

	identityHash(result: unknown): string {
		if (!result || typeof result !== "object" || Array.isArray(result)) throw new Unauthorized("Invalid external credentials or unlinked account.");
		const identity = result as Record<string, unknown>;
		if (identity.authenticated !== true || typeof identity.issuer !== "string" || !identity.issuer || identity.issuer.length > 512 || typeof identity.subject !== "string" || !identity.subject || identity.subject.length > 1024 || /[\u0000-\u001f]/.test(identity.issuer + identity.subject)) throw new Unauthorized("Invalid external credentials or unlinked account.");
		return createHash("sha256").update(JSON.stringify([identity.issuer, identity.subject])).digest("hex");
	}

	private async verify(pluginId: string, username: string, password: string): Promise<string> {
		if (pluginId.length > 128 || !/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(pluginId) || typeof username !== "string" || !username.trim() || username.length > 254 || typeof password !== "string" || !password || password.length > 1024) throw new BadRequest("Invalid external authentication request.");
		const plugin = await this.dataSource.getRepository(PluginInstallation).findOneBy({ pluginId, enabled: true });
		if (!plugin || !this.isDirectoryProvider(plugin)) throw new NotFound("Authentication provider not found.");
		const result = await this.runtime.execute(plugin, "auth-verify", { id: "system", role: "system" }, { username: username.trim(), password }, "flixer", "authentication");
		return this.identityHash(result);
	}
}