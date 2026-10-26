import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { isAbsolute, resolve, sep } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";
import tar from "tar-stream";

const MAX_ENTRIES = 10_000;
const MAX_FILE_BYTES = 100 * 1024 * 1024;
const MAX_UNPACKED_BYTES = 250 * 1024 * 1024;

function safeEntryPath(name: string, destination: string): string {
	if (!name || name.includes("\\") || name.includes("\0") || isAbsolute(name) || !/^[A-Za-z0-9._/-]+$/.test(name)) {
		throw new Error("Plugin archive contains an invalid path.");
	}
	const normalizedName = name.endsWith("/") ? name.slice(0, -1) : name;
	const segments = normalizedName.split("/");
	if (segments.some((segment) => !segment || segment === "." || segment === ".." || /^[A-Za-z]:$/.test(segment))) {
		throw new Error("Plugin archive contains a path traversal entry.");
	}
	const destinationPath = resolve(destination, normalizedName);
	if (!destinationPath.startsWith(`${resolve(destination)}${sep}`)) {
		throw new Error("Plugin archive entry escapes its staging directory.");
	}
	return destinationPath;
}

export async function extractPluginArchive(archive: Buffer, destination: string): Promise<void> {
	const extractor = tar.extract();
	const entries = new Set<string>();
	let entryCount = 0;
	let unpackedBytes = 0;
	let pipelineError: unknown;
	const archivePipeline = pipeline(Readable.from(archive), createGunzip(), extractor).catch((error: unknown) => {
		pipelineError = error;
	});

	try {
		for await (const entry of extractor) {
			entryCount += 1;
			if (entryCount > MAX_ENTRIES) {
				throw new Error("Plugin archive contains too many entries.");
			}

			const { name, size = 0, type } = entry.header;
			const outputPath = safeEntryPath(name, destination);
			const normalizedName = name.endsWith("/") ? name.slice(0, -1) : name;
			if (entries.has(normalizedName)) {
				throw new Error("Plugin archive contains duplicate paths.");
			}
			entries.add(normalizedName);

			if (type === "directory") {
				if (size !== 0) throw new Error("Plugin archive directory entry has content.");
				await mkdir(outputPath, { recursive: true, mode: 0o755 });
				for await (const _chunk of entry) {
					throw new Error("Plugin archive directory entry has content.");
				}
				continue;
			}
			if (type !== "file" || size < 0 || size > MAX_FILE_BYTES) {
				throw new Error("Plugin archive contains an unsupported entry or oversized file.");
			}

			await mkdir(resolve(outputPath, ".."), { recursive: true, mode: 0o755 });
			const byteLimit = new Transform({
				transform(chunk: Buffer, _encoding, callback) {
					unpackedBytes += chunk.length;
					if (unpackedBytes > MAX_UNPACKED_BYTES) {
						callback(new Error("Plugin archive exceeds the unpacked size limit."));
						return;
					}
					callback(null, chunk);
				},
			});
			await pipeline(entry, byteLimit, createWriteStream(outputPath, { flags: "wx", mode: 0o644 }));
		}
		await archivePipeline;
		if (pipelineError) throw pipelineError;
	} catch (error: unknown) {
		extractor.destroy();
		await archivePipeline;
		throw error;
	}
}