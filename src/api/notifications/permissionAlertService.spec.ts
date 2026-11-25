import { describe, expect, it, vi } from "vitest";
import type { DataSource } from "typeorm";
import type { NotificationService } from "./notificationService.js";
import { extractPermissionPath, isPermissionError, PermissionAlertService } from "./permissionAlertService.js";

describe("permissionAlertService", () => {
	it("detects EACCES, EPERM, wrapped causes, and permission denied messages", () => {
		const eacces = Object.assign(new Error("EACCES: permission denied"), { code: "EACCES", path: "/media/Music" });
		expect(isPermissionError(eacces)).toBe(true);
		expect(extractPermissionPath(eacces)).toBe("/media/Music");

		const wrapped = { origin: Object.assign(new Error("forbidden"), { code: "EPERM" }) };
		expect(isPermissionError(wrapped)).toBe(true);

		const goErr = new Error("scan lib: read directory /media/Music/ABBA (2001): open /media/Music/ABBA (2001): permission denied");
		expect(isPermissionError(goErr)).toBe(true);
		expect(extractPermissionPath(goErr)).toBe("/media/Music/ABBA (2001)");

		expect(isPermissionError(new Error("ENOENT: no such file"))).toBe(false);
	});

	it("notifies active admins and deduplicates repeated alerts within cooldown", async () => {
		const find = vi.fn().mockResolvedValue([{ id: "admin-1" }, { id: "admin-2" }]);
		const dataSource = { getRepository: vi.fn().mockReturnValue({ find }) } as unknown as DataSource;
		const send = vi.fn().mockResolvedValue({ recipients: 2, pushed: 0 });
		const notifications = { send } as unknown as NotificationService;
		const service = new PermissionAlertService(dataSource, notifications);

		const err = Object.assign(new Error("EACCES: permission denied, open '/media/Music/ABBA (2001)'"), {
			code: "EACCES",
			path: "/media/Music/ABBA (2001)",
		});

		await expect(service.reportError(err, { source: "flixer-indexer", operation: "scan:library", url: "/admin?tab=indexer" }, 1_000)).resolves.toBe(true);
		expect(send).toHaveBeenCalledTimes(1);
		expect(send).toHaveBeenCalledWith(
			expect.objectContaining({
				kind: "admin",
				title: "Permission denied in flixer-indexer",
				url: "/admin?tab=indexer",
			}),
			["admin-1", "admin-2"],
		);

		// Same error within 15m cooldown is suppressed
		await expect(service.reportError(err, { source: "flixer-indexer", operation: "scan:library", url: "/admin?tab=indexer" }, 60_000)).resolves.toBe(false);
		expect(send).toHaveBeenCalledTimes(1);

		// After cooldown expires it notifies again
		await expect(service.reportError(err, { source: "flixer-indexer", operation: "scan:library", url: "/admin?tab=indexer" }, 1_000 + 16 * 60 * 1000)).resolves.toBe(true);
		expect(send).toHaveBeenCalledTimes(2);
	});
});
