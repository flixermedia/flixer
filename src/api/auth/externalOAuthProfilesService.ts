import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@tsed/di";
import { BadRequest, Conflict, NotFound } from "@tsed/exceptions";
import { DataSource } from "typeorm";
import { DefaultDataSource } from "../../datasources/defaultDataSource.datasource.js";
import { ExternalOAuthProvider } from "../../entities/externalOAuthProvider.entity.js";
import { PluginInstallation } from "../../entities/pluginInstallation.entity.js";
import { decryptPluginSettingSecret, encryptPluginSettingSecret } from "../plugins/pluginSettingsSecrets.js";
import { validateOAuthProfileSettings, type ExternalOAuthProfileSettings } from "./externalOAuthProfiles.js";

export interface ExternalOAuthProfileUpdate {
	name: string;
	enabled: boolean;
	settings: ExternalOAuthProfileSettings;
	clientSecret?: string;
}

const IDENTITY_SETTINGS: Array<keyof ExternalOAuthProfileSettings> = ["authorizationUrl", "tokenUrl", "userInfoUrl", "issuer", "subjectField", "clientId"];

@Injectable()
export class ExternalOAuthProfilesService {
	constructor(@Inject(DefaultDataSource) private readonly dataSource: DataSource) {}

	async list(pluginId: string) {
		await this.plugin(pluginId);
		const profiles = await this.dataSource.getRepository(ExternalOAuthProvider).find({ where: { pluginId }, order: { name: "ASC" } });
		return profiles.map((profile) => this.publicProfile(profile));
	}

	async save(pluginId: string, id: string | undefined, input: ExternalOAuthProfileUpdate) {
		await this.plugin(pluginId);
		if (!input || typeof input.name !== "string" || !input.name.trim() || input.name.length > 128 || /[\u0000-\u001f\u007f]/.test(input.name) || typeof input.enabled !== "boolean") throw new BadRequest("Invalid OAuth provider name or status.");
		const settings = validateOAuthProfileSettings(input.settings);
		if (input.clientSecret !== undefined && (typeof input.clientSecret !== "string" || Buffer.byteLength(input.clientSecret) > 4096)) throw new BadRequest("Invalid OAuth client secret.");
		return this.dataSource.transaction(async (manager) => {
			const repository = manager.getRepository(ExternalOAuthProvider);
			const existing = id ? await repository.findOne({ where: { id, pluginId }, lock: { mode: "pessimistic_write" } }) : null;
			if (id && !existing) throw new NotFound("OAuth provider not found.");
			const profileId = existing?.id ?? randomUUID();
			let secretCipher = existing?.secretCipher ?? null;
			if (input.clientSecret !== undefined) secretCipher = input.clientSecret ? encryptPluginSettingSecret(pluginId, `oauth-profile:${profileId}`, input.clientSecret) : null;
			if (settings.tokenAuthMethod === "none") secretCipher = null;
			if (settings.tokenAuthMethod !== "none" && !secretCipher) throw new BadRequest("A client secret is required for this authentication method.");
			if (existing && IDENTITY_SETTINGS.some((key) => existing.settings[key] !== settings[key])) {
				const links = await manager.query('SELECT 1 FROM "external_identities" WHERE "plugin_id" = $1 AND "provider_key" = $2 LIMIT 1', [pluginId, profileId]);
				if (links.length) throw new Conflict("Unlink all accounts before changing the provider identity configuration.");
			}
			const profile = repository.create({ id: profileId, pluginId, name: input.name.trim(), enabled: input.enabled, settings: { ...settings }, secretCipher, revision: randomUUID() });
			return this.publicProfile(await repository.save(profile));
		});
	}

	async remove(pluginId: string, id: string) {
		await this.plugin(pluginId);
		await this.dataSource.transaction(async (manager) => {
			const repository = manager.getRepository(ExternalOAuthProvider);
			const profile = await repository.findOne({ where: { id, pluginId }, lock: { mode: "pessimistic_write" } });
			if (!profile) throw new NotFound("OAuth provider not found.");
			const links = await manager.query('SELECT 1 FROM "external_identities" WHERE "plugin_id" = $1 AND "provider_key" = $2 LIMIT 1', [pluginId, id]);
			if (links.length) throw new Conflict("Unlink all accounts before removing this provider.");
			await repository.delete({ id, pluginId });
		});
	}

	async plugin(pluginId: string): Promise<PluginInstallation> {
		if (typeof pluginId !== "string" || pluginId.length > 128 || !/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(pluginId)) throw new NotFound("OAuth plugin not found.");
		const plugin = await this.dataSource.getRepository(PluginInstallation).findOneBy({ pluginId });
		if (!plugin || !plugin.manifest.capabilities.includes("auth.oauth.profiles") || !plugin.manifest.capabilities.includes("auth.oauth") || !["auth.identity.verify", "network.http.configured"].every((permission) => plugin.manifest.permissions.includes(permission) && plugin.approvedPermissions.includes(permission))) throw new NotFound("OAuth plugin not found.");
		return plugin;
	}

	async resolved(pluginId: string, id: string) {
		const plugin = await this.plugin(pluginId);
		const profile = await this.dataSource.getRepository(ExternalOAuthProvider).findOneBy({ id, pluginId, enabled: true });
		if (!plugin.enabled || !profile) throw new NotFound("Authentication provider not found.");
		const settings = validateOAuthProfileSettings(profile.settings);
		const clientSecret = profile.secretCipher ? decryptPluginSettingSecret(pluginId, `oauth-profile:${id}`, profile.secretCipher) : undefined;
		return { plugin, profile, settings: { ...settings, ...(clientSecret ? { clientSecret } : {}) } };
	}

	private publicProfile(profile: ExternalOAuthProvider) {
		return { id: profile.id, pluginId: profile.pluginId, name: profile.name, enabled: profile.enabled, settings: profile.settings, hasClientSecret: Boolean(profile.secretCipher) };
	}
}