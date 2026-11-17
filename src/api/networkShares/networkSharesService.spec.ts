import { describe, expect, it } from "vitest";
import type { DataSource } from "typeorm";
import { normalizeShareInput, shareRootId } from "./networkSharesService.js";
import { NetworkSharesService } from "./networkSharesService.js";

describe("network share settings", () => {
	const base = { name: "Media", host: "nas.local", share: "Media" };

	it("keeps omitted protocol and read-only defaults compatible with SMB", () => {
		expect(normalizeShareInput(base)).toMatchObject({ protocol: "smb", share: "Media", readOnly: true });
		expect(normalizeShareInput({ ...base, readOnly: false })).toMatchObject({ protocol: "smb", readOnly: false });
	});

	it("normalizes NFS exports to read-only roots without SMB credentials", () => {
		expect(normalizeShareInput({ ...base, protocol: "nfs", share: "/exports/media", username: "ignored", readOnly: false })).toMatchObject({
			protocol: "nfs",
			share: "/exports/media",
			username: null,
			readOnly: true,
		});
	});

	it("accepts authenticated WebDAV and generic S3 endpoints", () => {
		expect(normalizeShareInput({ ...base, protocol: "webdav", host: "https://dav.example.test/remote.php/dav/", share: "/media/" })).toMatchObject({
			host: "https://dav.example.test/remote.php/dav",
			share: "media",
			readOnly: true,
		});
		expect(normalizeShareInput({ ...base, protocol: "s3", host: "http://minio.local:9000", share: "movies/2025", username: "access", region: "us-east-2" })).toMatchObject({
			protocol: "s3",
			share: "movies/2025",
			region: "us-east-2",
			readOnly: true,
		});
	});

	it("rejects unsafe mount paths and endpoint credentials", () => {
		expect(() => normalizeShareInput({ ...base, protocol: "nfs", share: "/exports/../private" })).toThrow();
		expect(() => normalizeShareInput({ ...base, protocol: "webdav", host: "https://user:pass@dav.example.test", share: "/media" })).toThrow();
		expect(() => normalizeShareInput({ ...base, protocol: "s3", host: "https://minio.local", share: "bucket/../private", username: "access" })).toThrow();
	});

	it("requires both S3 credentials before attempting a connection", async () => {
		const repository = { create: (share: object) => share };
		const service = new NetworkSharesService({ getRepository: () => repository } as unknown as DataSource);
		await expect(service.create({ ...base, protocol: "s3", host: "https://minio.local", share: "bucket", username: "access" })).rejects.toThrow("S3 storage requires an access key and secret key.");
	});

	it("keeps root ids stable when a share changes protocol", () => {
		expect(shareRootId("1ddfbdda-5b58-407a-9c95-a2db96c61234")).toBe("share-1ddfbdda5b58");
	});
});