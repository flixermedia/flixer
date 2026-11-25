import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DataSource } from "typeorm";
import { invalidateMaintenanceCache, isMaintenanceExemptPath, shouldBlockForMaintenance } from "./maintenanceGuard.js";

function makeDataSource(enabled: boolean): DataSource {
	return {
		isInitialized: true,
		getRepository: () => ({
			findOneBy: vi.fn().mockResolvedValue({ key: "maintenance_mode", value: enabled }),
		}),
	} as unknown as DataSource;
}

describe("maintenanceGuard", () => {
	beforeEach(() => {
		invalidateMaintenanceCache();
	});

	it("exempts auth, admin, settings, setup status, and non-api paths", () => {
		expect(isMaintenanceExemptPath("/api/auth/login")).toBe(true);
		expect(isMaintenanceExemptPath("/api/admin/updates")).toBe(true);
		expect(isMaintenanceExemptPath("/api/settings/maintenance_mode")).toBe(true);
		expect(isMaintenanceExemptPath("/api/setup/status")).toBe(true);
		expect(isMaintenanceExemptPath("/healthz")).toBe(true);
		expect(isMaintenanceExemptPath("/api/media/home?limit=10")).toBe(false);
	});

	it("allows all requests when maintenance_mode is false", async () => {
		const blocked = await shouldBlockForMaintenance("/api/media/home", undefined, makeDataSource(false), {
			requireAdmin: vi.fn(),
		});
		expect(blocked).toBe(false);
	});

	it("blocks non-admin and unauthenticated requests when maintenance_mode is true", async () => {
		const ds = makeDataSource(true);
		expect(await shouldBlockForMaintenance("/api/media/home", undefined, ds, { requireAdmin: vi.fn() })).toBe(true);
		expect(
			await shouldBlockForMaintenance("/api/media/home", "Bearer user-token", ds, {
				requireAdmin: vi.fn().mockRejectedValue(new Error("Forbidden")),
			}),
		).toBe(true);
	});

	it("allows authenticated admins when maintenance_mode is true", async () => {
		const ds = makeDataSource(true);
		const requireAdmin = vi.fn().mockResolvedValue(undefined);
		const blocked = await shouldBlockForMaintenance("/api/media/home", "Bearer admin-token", ds, { requireAdmin });
		expect(blocked).toBe(false);
		expect(requireAdmin).toHaveBeenCalledWith("Bearer admin-token");
	});
});
