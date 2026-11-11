import { describe, expect, it, vi } from "vitest";
import type { DataSource } from "typeorm";
import { ExternalIdentity } from "../../entities/externalIdentity.entity.js";
import { PluginInstallation } from "../../entities/pluginInstallation.entity.js";
import { User } from "../../entities/user.entity.js";
import { ExternalAuthService } from "./externalAuthService.js";

function setup() {
	const plugin = { enabled: true, pluginId: "plugin.example", manifest: { name: "Directory", targets: { flixer: { entry: "auth.wasm" } }, capabilities: ["auth.directory"], permissions: ["auth.identity.verify", "auth.credentials"] }, approvedPermissions: ["auth.identity.verify", "auth.credentials"] };
	const identities = { findOneBy: vi.fn().mockResolvedValue(null), insert: vi.fn().mockResolvedValue(undefined), delete: vi.fn().mockResolvedValue(undefined) };
	const users = { findOneBy: vi.fn().mockResolvedValue({ id: "user" }) };
	const plugins = { findOneBy: vi.fn().mockResolvedValue(plugin), find: vi.fn().mockResolvedValue([plugin]) };
	const dataSource = { getRepository: vi.fn((entity) => entity === PluginInstallation ? plugins : entity === ExternalIdentity ? identities : entity === User ? users : null) } as unknown as DataSource;
	const auth = { reauthenticateUser: vi.fn().mockResolvedValue({ id: "user" }), completePrimaryAuthentication: vi.fn().mockResolvedValue({ accessToken: "session" }) };
	const runtime = { execute: vi.fn().mockResolvedValue({ authenticated: true, issuer: "directory", subject: "stable-id" }) };
	return { service: new ExternalAuthService(dataSource, auth as never, runtime as never), plugin, identities, users, auth, runtime };
}

describe("ExternalAuthService", () => {
	it("requires local reauthentication and stores only a hashed external identity", async () => {
		const { service, auth, runtime, identities } = setup();
		await expect(service.link("plugin.example", "external", "external-password", "local-password", "Bearer session")).resolves.toEqual({ linked: true });
		expect(auth.reauthenticateUser).toHaveBeenCalledWith("Bearer session", "local-password");
		expect(runtime.execute).toHaveBeenCalledWith(expect.anything(), "auth-verify", { id: "system", role: "system" }, { username: "external", password: "external-password" }, "flixer", "authentication");
		const stored = identities.insert.mock.calls[0][0];
		expect(stored).toEqual({ pluginId: "plugin.example", providerKey: "", identityHash: expect.stringMatching(/^[a-f0-9]{64}$/), userId: "user" });
		expect(JSON.stringify(stored)).not.toContain("external-password");
	});

	it("does not create accounts and delegates linked logins to Flixer's account checks", async () => {
		const { service, identities, auth } = setup();
		await expect(service.login("plugin.example", "external", "password")).rejects.toThrow("unlinked account");
		identities.findOneBy.mockResolvedValue({ userId: "user" });
		await expect(service.login("plugin.example", "external", "password")).resolves.toEqual({ accessToken: "session" });
		expect(auth.completePrimaryAuthentication).toHaveBeenCalledWith({ id: "user" });
	});

	it("rejects providers without both approved authentication grants", async () => {
		const { service, plugin, runtime } = setup();
		plugin.approvedPermissions = ["auth.identity.verify"];
		await expect(service.login("plugin.example", "external", "password")).rejects.toThrow("not found");
		expect(runtime.execute).not.toHaveBeenCalled();
	});
});