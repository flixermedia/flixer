import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DataSource } from "typeorm";
import { AppConfig, setAppConfig } from "../../config/store/appConfig.js";
import { ExternalAuthFlow } from "../../entities/externalAuthFlow.entity.js";
import { ExternalOAuthProvider } from "../../entities/externalOAuthProvider.entity.js";
import { PluginInstallation } from "../../entities/pluginInstallation.entity.js";
import { ExternalOAuthService } from "./externalOAuthService.js";

const browserSecret = Buffer.alloc(32, 7).toString("base64url");

function setup() {
	const plugin = { enabled: true, pluginId: "plugin.example", manifest: { targets: { flixer: { entry: "auth.wasm" } }, capabilities: ["auth.oidc"], permissions: ["auth.identity.verify", "network.http.login.example.com"] }, approvedPermissions: ["auth.identity.verify", "network.http.login.example.com"] };
	const flows = new Map<string, Record<string, unknown>>();
	const repository = {
		insert: vi.fn(async (flow: Record<string, unknown>) => { flows.set(flow.stateHash as string, flow); }),
		findOneBy: vi.fn(async (criteria: Record<string, unknown>) => { const flow = flows.get(criteria.stateHash as string); return flow && flow.browserHash === criteria.browserHash && flow.pluginId === criteria.pluginId && flow.providerKey === criteria.providerKey ? flow : null; }),
		delete: vi.fn(async (criteria: Record<string, unknown>) => ({ affected: criteria.stateHash && flows.delete(criteria.stateHash as string) ? 1 : 0 })),
	};
	const lockedProfile = { findOne: vi.fn() };
	const manager = { getRepository: vi.fn((entity) => entity === ExternalOAuthProvider ? lockedProfile : null) };
	const dataSource = { getRepository: vi.fn((entity) => entity === ExternalAuthFlow ? repository : entity === PluginInstallation ? { findOneBy: vi.fn().mockResolvedValue(plugin) } : null), transaction: vi.fn(async (callback) => callback(manager)) } as unknown as DataSource;
	const auth = { reauthenticateUser: vi.fn().mockResolvedValue({ id: "user" }), requireAuthenticatedSession: vi.fn().mockResolvedValue({ user: { id: "user" } }) };
	const external = { isOAuthProvider: vi.fn().mockReturnValue(true), identityHash: vi.fn().mockReturnValue("identity"), bindIdentity: vi.fn().mockResolvedValue({ linked: true }), loginIdentity: vi.fn().mockResolvedValue({ accessToken: "session" }) };
	let nonce = "";
	const runtime = { execute: vi.fn(async (_plugin, operation, _user, input) => {
		if (operation === "auth-complete") return { authenticated: true, issuer: "issuer", subject: "subject", nonce };
		nonce = input.nonce;
		const url = new URL("https://login.example.com/authorize");
		for (const [key, value] of Object.entries({ state: input.state, nonce, scope: "openid profile", code_challenge: input.codeChallenge, code_challenge_method: "S256", redirect_uri: input.redirectUri, response_type: "code" })) url.searchParams.set(key, value as string);
		return { authorizationUrl: url.toString() };
	}) };
	const profiles = { resolved: vi.fn() };
	return { service: new ExternalOAuthService(dataSource, auth as never, external as never, runtime as never, profiles as never), plugin, flows, repository, auth, external, runtime, profiles, lockedProfile, manager };
}

describe("ExternalOAuthService", () => {
	afterEach(() => { vi.unstubAllEnvs(); setAppConfig(undefined); });

	it("binds PKCE and one-time state to the initiating browser and linked session", async () => {
		vi.stubEnv("APP_SECRET", "test-shared-secret-with-at-least-32-bytes");
		vi.stubEnv("APP_URL", "https://flixer.example");
		setAppConfig(new AppConfig(null));
		const { service, auth, external, runtime } = setup();
		const start = await service.start("plugin.example", browserSecret, true, "local-password", "Bearer session");
		const url = new URL(start.authorizationUrl);
		expect(url.searchParams.get("code_challenge_method")).toBe("S256");
		expect(url.searchParams.get("redirect_uri")).toBe("https://flixer.example/auth/provider-callback");
		expect(auth.reauthenticateUser).toHaveBeenCalledWith("Bearer session", "local-password");
		await expect(service.finish("plugin.example", start.state, Buffer.alloc(32, 8).toString("base64url"), "code", "Bearer session")).rejects.toThrow("invalid");
		auth.requireAuthenticatedSession.mockResolvedValueOnce({ user: { id: "other" } });
		await expect(service.finish("plugin.example", start.state, browserSecret, "code", "Bearer other")).rejects.toThrow("invalid");
		await expect(service.finish("plugin.example", start.state, browserSecret, "code", "Bearer session")).resolves.toEqual({ linked: true });
		expect(external.bindIdentity).toHaveBeenCalledWith("plugin.example", "identity", "user");
		expect(runtime.execute).toHaveBeenLastCalledWith(pluginMatcher(), "auth-complete", expect.anything(), expect.objectContaining({ code: "code", codeVerifier: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/) }), "flixer", "authentication");
		const verifier = runtime.execute.mock.calls.at(-1)?.[3].codeVerifier as string;
		expect(createHash("sha256").update(verifier).digest("base64url")).toBe(url.searchParams.get("code_challenge"));
		await expect(service.finish("plugin.example", start.state, browserSecret, "code", "Bearer session")).rejects.toThrow("invalid");
	});

	it("signs in only a previously linked identity", async () => {
		vi.stubEnv("APP_SECRET", "test-shared-secret-with-at-least-32-bytes");
		vi.stubEnv("APP_URL", "https://flixer.example");
		setAppConfig(new AppConfig(null));
		const { service, auth, external } = setup();
		const start = await service.start("plugin.example", browserSecret, false, undefined);
		await expect(service.finish("plugin.example", start.state, browserSecret, "code")).resolves.toEqual({ accessToken: "session" });
		expect(external.loginIdentity).toHaveBeenCalledWith("plugin.example", "identity");
		expect(auth.reauthenticateUser).not.toHaveBeenCalled();
	});

	it("rejects an OIDC identity with the wrong nonce", async () => {
		vi.stubEnv("APP_SECRET", "test-shared-secret-with-at-least-32-bytes");
		vi.stubEnv("APP_URL", "https://flixer.example");
		setAppConfig(new AppConfig(null));
		const { service, runtime, external } = setup();
		const start = await service.start("plugin.example", browserSecret, false, undefined);
		runtime.execute.mockResolvedValueOnce({ authenticated: true, issuer: "issuer", subject: "subject", nonce: "incorrect" });
		await expect(service.finish("plugin.example", start.state, browserSecret, "code")).rejects.toThrow("invalid");
		expect(external.loginIdentity).not.toHaveBeenCalled();
	});

	it("rejects unsafe authorization destinations before saving state", async () => {
		vi.stubEnv("APP_SECRET", "test-shared-secret-with-at-least-32-bytes");
		vi.stubEnv("APP_URL", "https://flixer.example");
		setAppConfig(new AppConfig(null));
		const { service, runtime, repository } = setup();
		runtime.execute.mockResolvedValueOnce({ authorizationUrl: "https://attacker.example/authorize" });
		await expect(service.start("plugin.example", browserSecret, false, undefined)).rejects.toThrow("unsafe authorization URL");
		expect(repository.insert).not.toHaveBeenCalled();
	});

	it("binds a configured OAuth flow to its provider and configuration revision", async () => {
		vi.stubEnv("APP_SECRET", "test-shared-secret-with-at-least-32-bytes");
		vi.stubEnv("APP_URL", "https://flixer.example");
		setAppConfig(new AppConfig(null));
		const { service, plugin, profiles, lockedProfile, external, manager } = setup();
		plugin.manifest.capabilities = ["auth.oauth", "auth.oauth.profiles"];
		const profileId = "8f8b4e43-655f-463e-a034-55ca2434d7e8";
		const profile = { id: profileId, revision: "revision-one", enabled: true };
		const settings = { authorizationUrl: "https://login.example.com/authorize", tokenUrl: "https://login.example.com/token", userInfoUrl: "https://api.example.com/user", clientId: "client" };
		profiles.resolved.mockResolvedValue({ plugin, profile, settings });
		lockedProfile.findOne.mockResolvedValue(profile);
		const id = `plugin.example~${profileId}`;
		const start = await service.start(id, browserSecret, true, "local-password", "Bearer session");
		await expect(service.finish("plugin.example~d77bb340-9c0a-4473-9e03-3f4907642ea4", start.state, browserSecret, "code", "Bearer session")).rejects.toThrow("invalid");
		profiles.resolved.mockResolvedValueOnce({ plugin, profile: { ...profile, revision: "revision-two" }, settings });
		await expect(service.finish(id, start.state, browserSecret, "code", "Bearer session")).rejects.toThrow("invalid");
		await expect(service.finish(id, start.state, browserSecret, "code", "Bearer session")).resolves.toEqual({ linked: true });
		expect(external.bindIdentity).toHaveBeenCalledWith("plugin.example", "identity", "user", profileId, manager);
	});
});

function pluginMatcher() { return expect.objectContaining({ pluginId: "plugin.example" }); }