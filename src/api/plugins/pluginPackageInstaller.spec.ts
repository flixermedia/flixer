import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import tar from "tar-stream";
import { installPluginPackageAtomically } from "./pluginPackageInstaller.js";
import type { PluginManifest } from "./pluginManifest.js";

const manifest: PluginManifest = {
	manifestVersion: 1,
	id: "flixer.example",
	name: "Example Plugin",
	version: "1.0.0",
	description: "An example plugin.",
	author: "Flixer",
	license: "MIT",
	compatibility: { pluginApi: "^1.0.0" },
	targets: { flixer: { entry: "backend/worker.wasm" } },
	capabilities: ["metadata.provider"],
	permissions: [],
};

async function makeArchive(packageManifest: PluginManifest): Promise<Buffer> {
	const pack = tar.pack();
	const chunks: Buffer[] = [];
	pack.on("data", (chunk: Buffer) => chunks.push(chunk));
	const finished = new Promise<Buffer>((resolve, reject) => {
		pack.on("error", reject);
		pack.on("end", () => resolve(Buffer.concat(chunks)));
	});
	for (const [name, body] of [
		["plugin.json", Buffer.from(JSON.stringify(packageManifest))],
		["backend/worker.wasm", Buffer.from([0, 97, 115, 109])],
	] as const) {
		pack.entry({ name, size: body.length, type: "file" }, body);
	}
	pack.finalize();
	return gzipSync(await finished);
}

describe("installPluginPackageAtomically", () => {
	it("installs a verified package and keeps plugin data separate", async () => {
		const root = await mkdtemp(join(tmpdir(), "flixer-plugin-install-"));
		try {
			const result = await installPluginPackageAtomically(
				root,
				await makeArchive(manifest),
				manifest,
				"a".repeat(64),
				async () => undefined,
			);
			expect(result.installPath).toBe(join(root, "installed", manifest.id));
			expect(await readFile(join(result.installPath, "backend/worker.wasm"))).toEqual(Buffer.from([0, 97, 115, 109]));
			await writeFile(join(root, "data", manifest.id, "state.json"), "{}");
			expect(await readFile(join(root, "data", manifest.id, "state.json"), "utf8")).toBe("{}");
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("restores the previous package if persistence fails", async () => {
		const root = await mkdtemp(join(tmpdir(), "flixer-plugin-rollback-"));
		const previous = join(root, "installed", manifest.id);
		try {
			await mkdir(previous, { recursive: true });
			await writeFile(join(previous, "version.txt"), "old");
			await expect(
				installPluginPackageAtomically(root, await makeArchive(manifest), manifest, "b".repeat(64), async () => {
					throw new Error("database unavailable");
				}),
			).rejects.toThrow("database unavailable");
			expect(await readFile(join(previous, "version.txt"), "utf8")).toBe("old");
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("rejects package contents that disagree with the downloaded manifest", async () => {
		const root = await mkdtemp(join(tmpdir(), "flixer-plugin-mismatch-"));
		try {
			await expect(
				installPluginPackageAtomically(
					root,
					await makeArchive({ ...manifest, description: "Changed in archive." }),
					manifest,
					"c".repeat(64),
					async () => undefined,
				),
			).rejects.toThrow("does not match");
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});