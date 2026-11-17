import { describe, expect, it } from "vitest";
import { mountBaseDir } from "./shareMounter.js";
import { smbMountSupported } from "./smbSupport.js";

describe("smbMountSupported", () => {
	it("is supported on a normal Linux host", () => {
		expect(smbMountSupported("6.8.0-45-generic", undefined)).toBe(true);
	});

	it("is not supported on Docker Desktop (macOS, Windows) or WSL2", () => {
		expect(smbMountSupported("7.0.14-linuxkit", undefined)).toBe(false);
		expect(smbMountSupported("5.15.153.1-microsoft-standard-WSL2", undefined)).toBe(false);
	});

	it("can be overridden", () => {
		expect(smbMountSupported("7.0.14-linuxkit", "true")).toBe(true);
		expect(smbMountSupported("6.8.0-generic", "false")).toBe(false);
	});
});

describe("mountBaseDir", () => {
	it("stores SMB mounts under DATA_PATH/mounts", () => {
		const originalDataPath = process.env.DATA_PATH;
		const originalMountDir = process.env.SMB_MOUNT_DIR;
		process.env.DATA_PATH = "/tmp/flixer-data";
		process.env.SMB_MOUNT_DIR = "/legacy/mounts";
		try {
			expect(mountBaseDir()).toBe("/tmp/flixer-data/mounts");
		} finally {
			if (originalDataPath === undefined) delete process.env.DATA_PATH;
			else process.env.DATA_PATH = originalDataPath;
			if (originalMountDir === undefined) delete process.env.SMB_MOUNT_DIR;
			else process.env.SMB_MOUNT_DIR = originalMountDir;
		}
	});
});
