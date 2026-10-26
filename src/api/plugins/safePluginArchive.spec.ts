import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import tar from "tar-stream";
import { extractPluginArchive } from "./safePluginArchive.js";

async function makeArchive(entries: Array<{ name: string; body?: string; type?: "file" | "symlink"; linkname?: string }>): Promise<Buffer> {
	const pack = tar.pack();
	const chunks: Buffer[] = [];
	pack.on("data", (chunk: Buffer) => chunks.push(chunk));
	const finished = new Promise<Buffer>((resolve, reject) => {
		pack.on("error", reject);
		pack.on("end", () => resolve(Buffer.concat(chunks)));
	});
	for (const entry of entries) {
		const body = Buffer.from(entry.body ?? "");
		pack.entry({ name: entry.name, size: body.length, type: entry.type ?? "file", linkname: entry.linkname }, body);
	}
	pack.finalize();
	return gzipSync(await finished);
}

describe("extractPluginArchive", () => {
	it("extracts ordinary files into the requested staging directory", async () => {
		const root = await mkdtemp(join(tmpdir(), "flixer-plugin-archive-"));
		const destination = join(root, "staged");
		await import("node:fs/promises").then(({ mkdir }) => mkdir(destination));
		try {
			await extractPluginArchive(await makeArchive([{ name: "plugin.json", body: "{}" }, { name: "web/index.html", body: "ok" }]), destination);
			expect(await readFile(join(destination, "web/index.html"), "utf8")).toBe("ok");
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it.each([
		{ title: "parent traversal", entries: [{ name: "../escape.txt", body: "no" }] },
		{ title: "absolute paths", entries: [{ name: "/absolute.txt", body: "no" }] },
		{ title: "symlinks", entries: [{ name: "link", type: "symlink" as const, linkname: "../../escape.txt" }] },
		{
			title: "duplicate paths",
			entries: [{ name: "duplicate.txt", body: "first" }, { name: "duplicate.txt", body: "second" }],
		},
	])("rejects $title", async ({ entries }) => {
		const root = await mkdtemp(join(tmpdir(), "flixer-plugin-archive-"));
		const destination = join(root, "staged");
		await import("node:fs/promises").then(({ mkdir }) => mkdir(destination));
		try {
			await expect(extractPluginArchive(await makeArchive(entries), destination)).rejects.toThrow();
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});