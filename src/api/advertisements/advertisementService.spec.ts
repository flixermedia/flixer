import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", () => ({
	execFile: (_command: string, _args: string[], _options: object, callback: (error: null, result: { stdout: string }) => void) => {
		callback(null, { stdout: JSON.stringify({ format: { format_name: "mov,mp4", duration: "10" }, streams: [{ codec_type: "video", codec_name: "h264" }] }) });
	},
}));

import { AdvertisementService } from "./advertisementService.js";

const directories: string[] = [];

afterEach(async () => {
	vi.unstubAllEnvs();
	for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});

describe("advertisement upload", () => {
	it("publishes a streamer-readable file while staging remains private", async () => {
		const root = await mkdtemp(join(tmpdir(), "flixer-ad-"));
		directories.push(root);
		vi.stubEnv("DATA_PATH", root);
		const repository = { create: vi.fn((row) => row), save: vi.fn(async (row) => row) };
		const service = new AdvertisementService({ getRepository: () => repository } as never);
		const bytes = Buffer.from("uploaded video");
		const upload = await service.createUpload("admin", bytes.length);
		await service.putChunk(upload.id, "admin", 0, bytes);
		expect((await stat(join(root, "advertisements", ".uploads", upload.id, "chunk-0"))).mode & 0o777).toBe(0o600);
		const ad = await service.completeUpload(upload.id, "admin", { name: "Example", targetUrl: "https://example.com" });
		const file = join(root, "advertisements", ad.filename);
		expect(await readFile(file)).toEqual(bytes);
		expect((await stat(file)).mode & 0o777).toBe(0o644);
		expect(ad.enabled).toBe(false);
	});

	it("coalesces concurrent completion requests without creating duplicate ads", async () => {
		const root = await mkdtemp(join(tmpdir(), "flixer-ad-"));
		directories.push(root);
		vi.stubEnv("DATA_PATH", root);
		const repository = { create: vi.fn((row) => row), save: vi.fn(async (row) => row) };
		const service = new AdvertisementService({ getRepository: () => repository } as never);
		const bytes = Buffer.from("uploaded video");
		const upload = await service.createUpload("admin", bytes.length);
		await service.putChunk(upload.id, "admin", 0, bytes);
		const body = { name: "Example", targetUrl: "https://example.com" };
		const [first, second] = await Promise.all([service.completeUpload(upload.id, "admin", body), service.completeUpload(upload.id, "admin", body)]);
		expect(first.id).toBe(second.id);
		expect(repository.save).toHaveBeenCalledTimes(1);
	});

	it("allows retry after a failed catalog write", async () => {
		const root = await mkdtemp(join(tmpdir(), "flixer-ad-"));
		directories.push(root);
		vi.stubEnv("DATA_PATH", root);
		const repository = {
			create: vi.fn((row) => row),
			save: vi.fn().mockRejectedValueOnce(new Error("database unavailable")).mockImplementation(async (row) => row),
		};
		const service = new AdvertisementService({ getRepository: () => repository } as never);
		const bytes = Buffer.from("uploaded video");
		const upload = await service.createUpload("admin", bytes.length);
		await service.putChunk(upload.id, "admin", 0, bytes);
		const body = { name: "Example", targetUrl: "https://example.com" };
		await expect(service.completeUpload(upload.id, "admin", body)).rejects.toThrow("database unavailable");
		const ad = await service.completeUpload(upload.id, "admin", body);
		expect(await readFile(join(root, "advertisements", ad.filename))).toEqual(bytes);
	});

	it("does not allow a skip delay longer than the advertisement", async () => {
		const ad = { id: "ad", durationSeconds: 10.5 };
		const repository = { findOneBy: vi.fn().mockResolvedValue(ad), save: vi.fn(async (value) => value) };
		const service = new AdvertisementService({ getRepository: () => repository } as never);
		const body = { name: "Example", targetUrl: "https://example.com", enabled: true, preroll: true, scopes: [{ type: "all", ref: null }], midrollSeconds: [], skipAfterSeconds: 11 };
		await expect(service.update("ad", body)).rejects.toThrow("Invalid advertisement setting");
		expect((await service.update("ad", { ...body, skipAfterSeconds: 10 })).skipAfterSeconds).toBe(10);
	});

	it("does not delete a file outside the advertisement directory if metadata is invalid", async () => {
		const repository = { findOneBy: vi.fn().mockResolvedValue({ id: "ad", filename: "../other" }), delete: vi.fn() };
		const service = new AdvertisementService({ getRepository: () => repository } as never);
		await expect(service.remove("ad")).rejects.toThrow("Invalid advertisement filename");
		expect(repository.delete).not.toHaveBeenCalled();
	});
});
