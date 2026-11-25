import type { DataSource } from "typeorm";
import { Setting } from "../../entities/setting.entity.js";
import type { AuthService } from "../auth/authService.js";

const CACHE_TTL_MS = 1000;

let cachedEnabled: boolean | null = null;
let cacheExpiresAt = 0;

const EXEMPT_PREFIXES = ["/api/auth/", "/api/admin/", "/api/settings", "/api/setup/status", "/api/sentry/config/web", "/api/oidc/"];

/** Returns true when a request path must stay accessible during manual maintenance mode. */
export function isMaintenanceExemptPath(rawUrl: string): boolean {
	const path = rawUrl.split("?")[0] || "";
	if (!path.startsWith("/api/")) return true;
	return EXEMPT_PREFIXES.some((prefix) => path === prefix || path.startsWith(prefix));
}

export function invalidateMaintenanceCache(): void {
	cachedEnabled = null;
	cacheExpiresAt = 0;
}

export async function isMaintenanceModeEnabled(dataSource: DataSource): Promise<boolean> {
	const now = Date.now();
	if (cachedEnabled !== null && now < cacheExpiresAt) {
		return cachedEnabled;
	}
	if (!dataSource.isInitialized) return false;
	const row = await dataSource.getRepository(Setting).findOneBy({ key: "maintenance_mode" });
	cachedEnabled = row?.value === true;
	cacheExpiresAt = now + CACHE_TTL_MS;
	return cachedEnabled;
}

/** Returns true when the request should be blocked with 503 maintenance mode. */
export async function shouldBlockForMaintenance(
	rawUrl: string,
	authorization: string | undefined,
	dataSource: DataSource,
	authService: Pick<AuthService, "requireAdmin">,
): Promise<boolean> {
	if (isMaintenanceExemptPath(rawUrl)) return false;
	if (!(await isMaintenanceModeEnabled(dataSource))) return false;
	if (!authorization) return true;
	try {
		await authService.requireAdmin(authorization);
		return false;
	} catch {
		return true;
	}
}
