import { afterEach, describe, expect, it, vi } from "vitest";
import type { DataSource } from "typeorm";
import { AppConfig, setAppConfig } from "../../config/store/appConfig.js";
import { ExternalOAuthProvider } from "../../entities/externalOAuthProvider.entity.js";
import { PluginInstallation } from "../../entities/pluginInstallation.entity.js";
import { oauthProfileId, splitOAuthProfileId, validateOAuthProfileSettings } from "./externalOAuthProfiles.js";
import { ExternalOAuthProfilesService } from "./externalOAuthProfilesService.js";

const profile = {
	authorizationUrl: "https://login.example.com/authorize",
	tokenUrl: "https://login.example.com/token",
	userInfoUrl: "https://api.example.com/user",
	issuer: "https://login.example.com",
	subjectField: "sub",
	scope: "profile",
	clientId: "client",
	tokenAuthMethod: "client_secret_post",
};

describe("configurable OAuth profiles", () => {
	it("normalizes valid provider settings", () => {
		expect(validateOAuthProfileSettings(profile)).toMatchObject({ ...profile, issuer: "https://login.example.com/" });
	});

	it.each(["http://example.com/", "https://localhost/", "https://127.0.0.1/", "https://user:password@example.com/", "https://example.com/#fragment"])("rejects unsafe endpoints: %s", (url) => {
		expect(() => validateOAuthProfileSettings({ ...profile, tokenUrl: url })).toThrow();
	});

	it("rejects unsafe subject fields and unsupported client authentication", () => {
		expect(() => validateOAuthProfileSettings({ ...profile, subjectField: "__proto__.id" })).toThrow();
		expect(() => validateOAuthProfileSettings({ ...profile, tokenAuthMethod: "unsupported" })).toThrow();
		expect(() => validateOAuthProfileSettings({ ...profile, authorizationUrl: "https://example.com/authorize?state=attacker" })).toThrow();
	});

	it("uses an unambiguous provider identifier", () => {
		const id = oauthProfileId("example.oauth", "8f8b4e43-655f-463e-a034-55ca2434d7e8");
		expect(splitOAuthProfileId(id)).toEqual({ pluginId: "example.oauth", profileId: "8f8b4e43-655f-463e-a034-55ca2434d7e8" });
		expect(splitOAuthProfileId("example.oauth~invalid")).toBeNull();
	});
});

describe("OAuth profile storage", () => {
	afterEach(() => { vi.unstubAllEnvs(); setAppConfig(undefined); });

	function setup() {
		const plugin = { pluginId: "example.oauth", enabled: true, manifest: { capabilities: ["auth.oauth", "auth.oauth.profiles"], permissions: ["auth.identity.verify", "network.http.configured"] }, approvedPermissions: ["auth.identity.verify", "network.http.configured"] };
		const profiles = { findOne: vi.fn(), findOneBy: vi.fn(), create: vi.fn((value) => value), save: vi.fn(async (value) => value) };
		const manager = { getRepository: vi.fn(() => profiles), query: vi.fn(async () => []) };
		const dataSource = { getRepository: vi.fn((entity) => entity === PluginInstallation ? { findOneBy: vi.fn().mockResolvedValue(plugin) } : entity === ExternalOAuthProvider ? profiles : null), transaction: vi.fn(async (callback) => callback(manager)) } as unknown as DataSource;
		return { service: new ExternalOAuthProfilesService(dataSource), profiles, manager };
	}

	it("encrypts client secrets and never returns them in the admin response", async () => {
		vi.stubEnv("APP_SECRET", "test-shared-secret-with-at-least-32-bytes");
		setAppConfig(new AppConfig(null));
		const { service, profiles } = setup();
		const result = await service.save("example.oauth", undefined, { name: "Example", enabled: true, settings: profile as never, clientSecret: "private-secret" });
		expect(result.hasClientSecret).toBe(true);
		expect(JSON.stringify(result)).not.toContain("private-secret");
		const saved = profiles.save.mock.calls[0]![0];
		expect(saved.secretCipher).toBeTruthy();
		expect(JSON.stringify(saved)).not.toContain("private-secret");
	});

	it("refuses identity configuration changes when accounts are linked", async () => {
		const { service, profiles, manager } = setup();
		profiles.findOne.mockResolvedValue({ id: "8f8b4e43-655f-463e-a034-55ca2434d7e8", settings: validateOAuthProfileSettings(profile), secretCipher: "encrypted" });
		manager.query.mockResolvedValueOnce([{}]);
		await expect(service.save("example.oauth", "8f8b4e43-655f-463e-a034-55ca2434d7e8", { name: "Example", enabled: true, settings: { ...profile, issuer: "https://different.example" } as never })).rejects.toThrow("Unlink all accounts");
		expect(profiles.save).not.toHaveBeenCalled();
	});
});