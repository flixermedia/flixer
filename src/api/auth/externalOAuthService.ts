import { createHash, randomBytes } from "node:crypto";
import { Inject, Injectable } from "@tsed/di";
import { BadRequest, NotFound, ServiceUnavailable, Unauthorized } from "@tsed/exceptions";
import { DataSource, LessThan, MoreThan } from "typeorm";
import { DefaultDataSource } from "../../datasources/defaultDataSource.datasource.js";
import { ExternalAuthFlow } from "../../entities/externalAuthFlow.entity.js";
import { ExternalOAuthProvider } from "../../entities/externalOAuthProvider.entity.js";
import { PluginInstallation } from "../../entities/pluginInstallation.entity.js";
import { decryptPluginSettingSecret, encryptPluginSettingSecret } from "../plugins/pluginSettingsSecrets.js";
import { PluginWasiRuntime } from "../plugins/pluginWasiRuntime.js";
import { AuthService } from "./authService.js";
import { ExternalAuthService } from "./externalAuthService.js";
import { oauthCallbackUrl, splitOAuthProfileId } from "./externalOAuthProfiles.js";
import { ExternalOAuthProfilesService } from "./externalOAuthProfilesService.js";

const FLOW_LIFETIME_MS = 10 * 60_000;
const SECRET_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

@Injectable()
export class ExternalOAuthService {
	constructor(@Inject(DefaultDataSource) private readonly dataSource: DataSource, private readonly auth: AuthService, private readonly external: ExternalAuthService, private readonly runtime: PluginWasiRuntime, private readonly profiles: ExternalOAuthProfilesService) {}

	async start(pluginId: string, browserSecret: string, link: boolean, accountPassword: string | undefined, authorization?: string) {
		if (typeof browserSecret !== "string" || !SECRET_PATTERN.test(browserSecret) || typeof link !== "boolean") throw new BadRequest("Invalid external authentication request.");
		const profileId = splitOAuthProfileId(pluginId);
		const configured = profileId ? await this.profiles.resolved(profileId.pluginId, profileId.profileId) : null;
		const plugin = configured?.plugin ?? await this.provider(pluginId);
		const installationId = plugin.pluginId;
		const user = link ? await this.auth.reauthenticateUser(authorization, accountPassword ?? "") : null;
		const redirectUri = oauthCallbackUrl();
		const state = randomBytes(32).toString("base64url");
		const verifier = randomBytes(32).toString("base64url");
		const challenge = createHash("sha256").update(verifier).digest("base64url");
		const nonce = plugin.manifest.capabilities.includes("auth.oidc") ? randomBytes(32).toString("base64url") : null;
		const input = { state, codeChallenge: challenge, redirectUri, ...(nonce ? { nonce } : {}) };
		const result = configured
			? await this.runtime.execute(plugin, "auth-start", { id: "system", role: "system" }, input, "flixer", "authentication", { settings: configured.settings, tokenUrl: configured.settings.tokenUrl, userInfoUrl: configured.settings.userInfoUrl })
			: await this.runtime.execute(plugin, "auth-start", { id: "system", role: "system" }, input, "flixer", "authentication");
		if (!result || typeof result !== "object" || Array.isArray(result) || typeof (result as { authorizationUrl?: unknown }).authorizationUrl !== "string") throw new ServiceUnavailable("Authentication provider returned an invalid authorization URL.");
		const rawUrl = (result as { authorizationUrl: string }).authorizationUrl;
		let url: URL;
		try { url = new URL(rawUrl); } catch { throw new ServiceUnavailable("Authentication provider returned an invalid authorization URL."); }
		const permission = `network.http.${url.hostname.toLowerCase()}`;
		const approvedDestination = configured ? new URL(configured.settings.authorizationUrl) : null;
		const destinationAllowed = approvedDestination
			? url.origin === approvedDestination.origin && url.pathname === approvedDestination.pathname && [...approvedDestination.searchParams].every(([key, value]) => url.searchParams.getAll(key).length === 1 && url.searchParams.get(key) === value)
			: plugin.manifest.permissions.includes(permission) && plugin.approvedPermissions.includes(permission);
		const requiredParams = ["state", "redirect_uri", "response_type", "code_challenge", "code_challenge_method", ...(nonce ? ["nonce", "scope"] : [])];
		if (rawUrl.length > 4096 || url.protocol !== "https:" || url.username || url.password || url.hash || (url.port && url.port !== "443") || !destinationAllowed || requiredParams.some((key) => url.searchParams.getAll(key).length !== 1) || url.searchParams.get("state") !== state || url.searchParams.get("redirect_uri") !== redirectUri || url.searchParams.get("response_type") !== "code" || url.searchParams.get("code_challenge") !== challenge || url.searchParams.get("code_challenge_method") !== "S256" || (nonce && (url.searchParams.get("nonce") !== nonce || !url.searchParams.get("scope")?.split(/\s+/).includes("openid")))) {
			throw new ServiceUnavailable("Authentication provider returned an unsafe authorization URL.");
		}
		const repository = this.dataSource.getRepository(ExternalAuthFlow);
		await repository.delete({ expiresAt: LessThan(new Date()) });
		const stateHash = hash(state);
		await repository.insert({ stateHash, browserHash: hash(browserSecret), nonceHash: nonce ? hash(nonce) : null, pluginId: installationId, providerKey: profileId?.profileId ?? "", providerRevision: configured?.profile.revision ?? null, userId: user?.id ?? null, verifierCipher: encryptPluginSettingSecret(installationId, `oauth:${stateHash}`, verifier), redirectUri, expiresAt: new Date(Date.now() + FLOW_LIFETIME_MS) });
		return { authorizationUrl: url.toString(), state };
	}

	async finish(pluginId: string, state: string, browserSecret: string, code: string, authorization?: string) {
		if (typeof state !== "string" || !SECRET_PATTERN.test(state) || typeof browserSecret !== "string" || !SECRET_PATTERN.test(browserSecret) || typeof code !== "string" || !code || code.length > 4096) throw new BadRequest("Invalid external authentication callback.");
		const profileId = splitOAuthProfileId(pluginId);
		const configured = profileId ? await this.profiles.resolved(profileId.pluginId, profileId.profileId) : null;
		const plugin = configured?.plugin ?? await this.provider(pluginId);
		const installationId = plugin.pluginId;
		const repository = this.dataSource.getRepository(ExternalAuthFlow);
		const criteria = { stateHash: hash(state), browserHash: hash(browserSecret), pluginId: installationId, providerKey: profileId?.profileId ?? "", expiresAt: MoreThan(new Date()) };
		const flow = await repository.findOneBy(criteria);
		if (!flow || (configured && flow.providerRevision !== configured.profile.revision)) throw new Unauthorized("External sign-in expired or is invalid.");
		if (flow.userId) {
			const { user } = await this.auth.requireAuthenticatedSession(authorization);
			if (user.id !== flow.userId) throw new Unauthorized("External sign-in expired or is invalid.");
		}
		if ((await repository.delete(criteria)).affected !== 1) throw new Unauthorized("External sign-in expired or is invalid.");
		const verifier = decryptPluginSettingSecret(installationId, `oauth:${flow.stateHash}`, flow.verifierCipher);
		const input = { code, codeVerifier: verifier, redirectUri: flow.redirectUri };
		const result = configured
			? await this.runtime.execute(plugin, "auth-complete", { id: "system", role: "system" }, input, "flixer", "authentication", { settings: configured.settings, tokenUrl: configured.settings.tokenUrl, userInfoUrl: configured.settings.userInfoUrl })
			: await this.runtime.execute(plugin, "auth-complete", { id: "system", role: "system" }, input, "flixer", "authentication");
		if (flow.nonceHash && (!result || typeof result !== "object" || typeof (result as { nonce?: unknown }).nonce !== "string" || hash((result as { nonce: string }).nonce) !== flow.nonceHash)) throw new Unauthorized("External sign-in expired or is invalid.");
		const identityHash = this.external.identityHash(result);
		if (!configured || !profileId) return flow.userId ? this.external.bindIdentity(installationId, identityHash, flow.userId) : this.external.loginIdentity(installationId, identityHash);
		return this.dataSource.transaction(async (manager) => {
			const locked = await manager.getRepository(ExternalOAuthProvider).findOne({ where: { id: profileId.profileId, pluginId: installationId }, lock: { mode: "pessimistic_write" } });
			if (!locked?.enabled || locked.revision !== flow.providerRevision) throw new Unauthorized("External sign-in expired or is invalid.");
			return flow.userId ? this.external.bindIdentity(installationId, identityHash, flow.userId, profileId.profileId, manager) : this.external.loginIdentity(installationId, identityHash, profileId.profileId);
		});
	}

	private async provider(pluginId: string): Promise<PluginInstallation> {
		if (typeof pluginId !== "string" || pluginId.length > 128 || !/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(pluginId)) throw new NotFound("Authentication provider not found.");
		const plugin = await this.dataSource.getRepository(PluginInstallation).findOneBy({ pluginId, enabled: true });
		if (!plugin || !this.external.isOAuthProvider(plugin)) throw new NotFound("Authentication provider not found.");
		return plugin;
	}

}