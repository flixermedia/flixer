import { mkdtemp, mkdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DataSource } from "typeorm";
import type { NetworkSharesService } from "../networkShares/networkSharesService.js";
import { MediaLibrariesService } from "./mediaLibrariesService.js";
import { MediaRootsService } from "./mediaRootsService.js";

describe("library scan paths", () => {
	let directory: string;
	let rootId: string;
	let service: MediaLibrariesService;
	const previous = process.env.STREAM_MEDIA_ROOT;

	beforeEach(async () => {
		directory = await mkdtemp(join(tmpdir(), "flixer-folder-scan-"));
		await mkdir(join(directory, "Movies", "Selected"), { recursive: true });
		await mkdir(join(directory, "Movies-other"));
		await symlink(join(directory, "Movies-other"), join(directory, "Movies", "escape"));
		process.env.STREAM_MEDIA_ROOT = directory;
		const roots = new MediaRootsService({ roots: () => [] } as unknown as NetworkSharesService);
		rootId = roots.list()[0].id;
		const repository = { findOneBy: vi.fn().mockResolvedValue({ folders: [{ rootId, path: "Movies" }] }) };
		service = new MediaLibrariesService({ getRepository: () => repository } as unknown as DataSource, roots);
	});

	afterEach(async () => {
		if (previous === undefined) delete process.env.STREAM_MEDIA_ROOT;
		else process.env.STREAM_MEDIA_ROOT = previous;
		await rm(directory, { recursive: true, force: true });
	});

	it("resolves and deduplicates selected library directories", async () => {
		await expect(service.scanPaths("id", [{ rootId, path: "Movies/Selected" }, { rootId, path: "/Movies/Selected/" }]))
			.resolves.toEqual([join(directory, "Movies", "Selected")]);
		await expect(service.scanPaths("id", [{ rootId, path: "Movies" }])).resolves.toEqual([join(directory, "Movies")]);
	});

	it("rejects outside paths, traversal, missing folders and symlink escapes", async () => {
		for (const path of ["Movies-other", "", "Movies/../Movies-other", "Movies/missing", "Movies/escape"]) {
			await expect(service.scanPaths("id", [{ rootId, path }])).rejects.toThrow();
		}
		await expect(service.scanPaths("id", [])).rejects.toThrow();
		await expect(service.scanPaths("id", [{ rootId: "other", path: "Movies" }])).rejects.toThrow();
	});
});
