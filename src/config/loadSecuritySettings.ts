import type { DataSource } from "typeorm";
import { DEFAULT_LOGIN_SECURITY, setLoginSecurity, validateLoginSecurity } from "../api/auth/login/loginSecurity.js";
import { Setting } from "../entities/setting.entity.js";
import { DEFAULT_TRUSTED_PROXIES, setTrustedProxyConfig, validateTrustedProxyConfig } from "./trustedProxies.js";

export async function loadSecuritySettings(dataSource: DataSource, warn: (message: string) => void): Promise<void> {

	const repository = dataSource.getRepository(Setting);
	const [login, proxies] = await Promise.all([repository.findOneBy({ key: "login_security" }), repository.findOneBy({ key: "trusted_proxies" })]);
	try {
		setLoginSecurity(validateLoginSecurity(login?.value));
	} catch {
		setLoginSecurity(DEFAULT_LOGIN_SECURITY);
		warn("Invalid login security settings; using secure defaults.");
	}
	try {
		setTrustedProxyConfig(validateTrustedProxyConfig(proxies?.value));
	} catch {
		setTrustedProxyConfig(DEFAULT_TRUSTED_PROXIES);
		warn("Invalid trusted proxy settings; proxy trust is disabled.");
	}

}
