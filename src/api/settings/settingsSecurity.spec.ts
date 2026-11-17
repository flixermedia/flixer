import { afterEach, describe, expect, it, vi } from "vitest";
import type { DataSource } from "typeorm";
import { DEFAULT_LOGIN_SECURITY, getLoginSecurity, setLoginSecurity } from "../auth/login/loginSecurity.ts";
import { DEFAULT_TRUSTED_PROXIES, isTrustedProxy, setTrustedProxyConfig } from "../../config/trustedProxies.ts";
import { Setting } from "../../entities/setting.entity.ts";
import { SettingsService } from "./settingsService.ts";

function createService() {
	const repository = {
		findOneBy: vi.fn(async ({ key }: { key: string }) => ({ key, value: null, isPublic: false, updatedAt: new Date() }) as Setting),
		save: vi.fn(async (setting: Setting) => setting),
	};
	const auth = { requireAdmin: vi.fn().mockResolvedValue(undefined), requireAdminSession: vi.fn().mockResolvedValue(undefined) };
	const service = new SettingsService({ getRepository: () => repository } as unknown as DataSource, auth as never, {} as never, {} as never, { mask: (_key: string, value: unknown) => value } as never, {} as never);
	return { service, repository, auth };
}

describe("admin login security settings", () => {
	afterEach(() => {
		setLoginSecurity(DEFAULT_LOGIN_SECURITY);
		setTrustedProxyConfig(DEFAULT_TRUSTED_PROXIES);
	});

	it("validates and applies persisted security settings", async () => {
		const { service, repository } = createService();
		const security = { ...DEFAULT_LOGIN_SECURITY, timingEnabled: false, throttleEnabled: false, ipLimit: 5 };
		await expect(service.update("login_security", { value: security })).resolves.toMatchObject({ value: security, isPublic: false });
		expect(getLoginSecurity().config).toEqual(security);
		await expect(service.update("trusted_proxies", { value: { enabled: true, addresses: ["192.0.2.0/24"] } })).resolves.toMatchObject({ isPublic: false });
		expect(isTrustedProxy("192.0.2.10")).toBe(true);
		await service.update("trusted_proxies", { value: { enabled: false, addresses: ["192.0.2.0/24"] } });
		expect(isTrustedProxy("192.0.2.10")).toBe(false);
		expect(repository.save).toHaveBeenCalledTimes(3);
	});

	it("rejects invalid input and changes from non-admins", async () => {
		const { service, repository, auth } = createService();
		await expect(service.update("login_security", { value: { ...DEFAULT_LOGIN_SECURITY, ipLimit: 0 } })).rejects.toThrow();
		await expect(service.update("trusted_proxies", { value: { enabled: true, addresses: ["*"] } })).rejects.toThrow();
		expect(repository.save).not.toHaveBeenCalled();
		auth.requireAdminSession.mockRejectedValueOnce(new Error("forbidden"));
		await expect(service.update("trusted_proxies", { value: { enabled: true, addresses: ["192.0.2.1"] } })).rejects.toThrow("forbidden");
		expect(isTrustedProxy("192.0.2.1")).toBe(false);
	});

	it("does not apply settings if persistence fails", async () => {
		const { service, repository } = createService();
		repository.save.mockRejectedValueOnce(new Error("database unavailable"));
		await expect(service.update("login_security", { value: { ...DEFAULT_LOGIN_SECURITY, throttleEnabled: false } })).rejects.toThrow("database unavailable");
		expect(getLoginSecurity().config).toEqual(DEFAULT_LOGIN_SECURITY);
	});
});