import { describe, expect, it } from "vitest";
import { mountArgsFor, rcloneConfigFor, type MountTarget } from "./shareMounter.ts";

describe("network share mount configuration", () => {
	const base: MountTarget = {
		id: "share-id",
		protocol: "webdav",
		host: "https://dav.example.test",
		share: "media",
		username: "reader",
		domain: null,
		region: null,
		password: "secret-value",
		readOnly: true,
	};

	it("mounts NFS exports read-only", () => {
		const command = mountArgsFor({ ...base, protocol: "nfs", host: "nas.local", share: "/exports/media" }, "/data/mounts/share-id");
		expect(command).toEqual({ command: "mount", args: ["-t", "nfs", "-o", "ro,nosuid,nodev", "nas.local:/exports/media", "/data/mounts/share-id"] });
	});

	it("mounts WebDAV and S3 through read-only rclone FUSE", () => {
		expect(mountArgsFor(base, "/data/mounts/share-id").args).toContain("--read-only");
		expect(mountArgsFor({ ...base, protocol: "s3", share: "bucket/prefix", region: "us-east-1" }, "/data/mounts/share-id").args).toContain("--read-only");
	});

	it("keeps remote credentials out of mount arguments and obscures rclone passwords", () => {
		const args = mountArgsFor(base, "/data/mounts/share-id").args.join(" ");
		const config = rcloneConfigFor(base);
		expect(args).not.toContain(base.password!);
		expect(config).toContain("type = webdav");
		expect(config).toContain("pass = ");
		expect(config).not.toContain(base.password!);
	});

	it("preserves SMB read/write mount selection", () => {
		const command = mountArgsFor({ ...base, protocol: "smb", host: "nas.local", share: "Media", readOnly: false }, "/data/mounts/share-id");
		expect(command.args.join(",")).toContain("rw");
		expect(command.env).toEqual({ PASSWD: base.password });
	});
});