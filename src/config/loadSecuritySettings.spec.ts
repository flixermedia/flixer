import { afterEach, describe, expect, it, vi } from "vitest";
import type { DataSource } from "typeorm";
import { DEFAULT_LOGIN_SECURITY, getLoginSecurity, setLoginSecurity } from "../api/auth/login/loginSecurity.js";
import { loadSecuritySettings } from "./loadSecuritySettings.js";
import { DEFAULT_TRUSTED_PROXIES, isTrustedProxy, setTrustedProxyConfig } from "./trustedProxies.js";

function source(login: unknown, proxies: unknown): DataSource {
	return { getRepository: () => ({ findOneBy: async ({ key }: { key: string }) => ({ value: key === "login_security" ? login : proxies }) }) } as unknown as DataSource;
}

describe("loading security settings", () => {
	afterEach(() => {
		setLoginSecurity(DEFAULT_LOGIN_SECURITY);
		setTrustedProxyConfig(DEFAULT_TRUSTED_PROXIES);
	});

	it("restores persisted protection and proxy settings", async () => {
		const warn = vi.fn();
		const login = { ...DEFAULT_LOGIN_SECURITY, timingEnabled: false, throttleEnabled: false };
		await loadSecuritySettings(source(login, { enabled: true, addresses: ["192.0.2.0/24"] }), warn);
		expect(getLoginSecurity().config).toEqual(login);
		expect(isTrustedProxy("192.0.2.10")).toBe(true);
		expect(warn).not.toHaveBeenCalled();
	});

	it("uses secure defaults when persisted settings are invalid", async () => {
		setLoginSecurity({ ...DEFAULT_LOGIN_SECURITY, throttleEnabled: false });
		setTrustedProxyConfig({ enabled: true, addresses: ["192.0.2.0/24"] });
		const warn = vi.fn();
		await loadSecuritySettings(source({ throttleEnabled: false }, { enabled: true, addresses: ["*"] }), warn);
		expect(getLoginSecurity().config).toEqual(DEFAULT_LOGIN_SECURITY);
		expect(isTrustedProxy("192.0.2.10")).toBe(false);
		expect(warn).toHaveBeenCalledTimes(2);
	});
});