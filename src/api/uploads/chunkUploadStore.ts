import { BadRequest, Conflict, NotFound } from "@tsed/exceptions";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { link, mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export interface ChunkUpload {
	id: string;
	ownerId: string;
	size: number;
	chunkSize: number;
	createdAt: number;
}

/**
 * Stores immutable, independently retryable chunks under a private staging directory.
 * The caller must authenticate the owner before invoking these methods and remove the
 * session after validating and moving the assembled file to its permanent location.
 */
export class ChunkUploadStore {
	constructor(
		private readonly root: string,
		private readonly maxBytes: number,
		private readonly chunkSize: number,
		private readonly lifetimeMs: number,
	) {
		if (![maxBytes, chunkSize, lifetimeMs].every((value) => Number.isSafeInteger(value) && value > 0) || chunkSize > maxBytes) {
			throw new Error("Invalid chunk upload limits.");
		}
	}

	async create(ownerId: string, size: number): Promise<ChunkUpload> {
		if (!ownerId || !Number.isSafeInteger(size) || size < 1 || size > this.maxBytes) {
			throw new BadRequest("Invalid upload size.");
		}
		const upload: ChunkUpload = { id: randomUUID(), ownerId, size, chunkSize: this.chunkSize, createdAt: Date.now() };
		const directory = this.directory(upload.id);
		await mkdir(this.root, { recursive: true, mode: 0o700 });
		await this.removeExpired();
		await mkdir(directory, { mode: 0o700 });
		try {
			await writeFile(join(directory, "session.tmp"), JSON.stringify(upload), { flag: "wx", mode: 0o600 });
			await rename(join(directory, "session.tmp"), join(directory, "session.json"));
		} catch (error) {
			await rm(directory, { recursive: true, force: true });
			throw error;
		}
		return upload;
	}

	async put(id: string, ownerId: string, index: number, bytes: Buffer): Promise<void> {
		const upload = await this.get(id, ownerId);
		const count = Math.ceil(upload.size / upload.chunkSize);
		if (!Number.isSafeInteger(index) || index < 0 || index >= count) {
			throw new BadRequest("Invalid chunk index.");
		}
		const expectedSize = Math.min(upload.chunkSize, upload.size - index * upload.chunkSize);
		if (!Buffer.isBuffer(bytes) || bytes.length !== expectedSize) {
			throw new BadRequest("Invalid chunk size.");
		}
		const directory = this.directory(id);
		const target = join(directory, `chunk-${index}`);
		const temporary = join(directory, `part-${randomUUID()}`);
		try {
			await writeFile(temporary, bytes, { flag: "wx", mode: 0o600 });
			try {
				await link(temporary, target);
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
				const existing = await readFile(target);
				if (existing.length !== bytes.length || !createHash("sha256").update(existing).digest().equals(createHash("sha256").update(bytes).digest())) {
					throw new Conflict("This chunk was already uploaded with different content.");
				}
			}
		} finally {
			await rm(temporary, { force: true });
		}
	}

	/** Returns a staged file; it is not published to a permanent destination. */
	async assemble(id: string, ownerId: string): Promise<string> {
		const upload = await this.get(id, ownerId);
		const directory = this.directory(id);
		const count = Math.ceil(upload.size / upload.chunkSize);
		const temporary = join(directory, `assembly-${randomUUID()}`);
		const destination = join(directory, "assembled");
		try {
			const output = await open(temporary, "wx", 0o600);
			try {
				for (let index = 0; index < count; index++) {
					const path = join(directory, `chunk-${index}`);
					const expected = Math.min(upload.chunkSize, upload.size - index * upload.chunkSize);
					let actual: number;
					try {
						actual = (await stat(path)).size;
					} catch (error) {
						if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new Conflict("The upload is missing chunks.");
						throw error;
					}
					if (actual !== expected) throw new Conflict("An uploaded chunk has an invalid size.");
					for await (const part of createReadStream(path)) {
						const buffer = Buffer.isBuffer(part) ? part : Buffer.from(part);
						let offset = 0;
						while (offset < buffer.length) {
							const { bytesWritten } = await output.write(buffer, offset, buffer.length - offset);
							if (bytesWritten === 0) throw new Error("Could not write assembled upload.");
							offset += bytesWritten;
						}
					}
				}
			} finally {
				await output.close();
			}
			try {
				await link(temporary, destination);
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
			}
			return destination;
		} finally {
			await rm(temporary, { force: true });
		}
	}

	async remove(id: string, ownerId: string): Promise<void> {
		await this.get(id, ownerId, true);
		await rm(this.directory(id), { recursive: true, force: true });
	}

	private directory(id: string): string {
		if (!ID_PATTERN.test(id)) throw new NotFound("Upload not found.");
		return join(this.root, id);
	}

	private async removeExpired(): Promise<void> {
		const entries = await readdir(this.root, { withFileTypes: true });
		for (const entry of entries) {
			if (!entry.isDirectory() || !ID_PATTERN.test(entry.name)) continue;
			let raw: string;
			try {
				raw = await readFile(join(this.directory(entry.name), "session.json"), "utf8");
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
				throw error;
			}
			const metadata: unknown = JSON.parse(raw);
			if (!metadata || typeof metadata !== "object" || !("id" in metadata) || metadata.id !== entry.name ||
				!("createdAt" in metadata) || typeof metadata.createdAt !== "number" || !Number.isSafeInteger(metadata.createdAt)) {
				throw new Error("Invalid upload session metadata.");
			}
			if (Date.now() - metadata.createdAt >= this.lifetimeMs) await rm(this.directory(entry.name), { recursive: true, force: true });
		}
	}

	private async get(id: string, ownerId: string, allowExpired = false): Promise<ChunkUpload> {
		let raw: string;
		try {
			raw = await readFile(join(this.directory(id), "session.json"), "utf8");
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new NotFound("Upload not found.");
			throw error;
		}
		const upload: unknown = JSON.parse(raw);
		if (!upload || typeof upload !== "object" || !("id" in upload) || !("ownerId" in upload) || !("size" in upload) || !("chunkSize" in upload) || !("createdAt" in upload)) {
			throw new Error("Invalid upload session metadata.");
		}
		if (upload.id !== id || upload.ownerId !== ownerId) throw new NotFound("Upload not found.");
		if (typeof upload.size !== "number" || !Number.isSafeInteger(upload.size) || upload.size < 1 || upload.size > this.maxBytes || upload.chunkSize !== this.chunkSize || typeof upload.createdAt !== "number" || !Number.isSafeInteger(upload.createdAt)) {
			throw new Error("Invalid upload session metadata.");
		}
		if (!allowExpired && Date.now() - upload.createdAt >= this.lifetimeMs) throw new NotFound("Upload has expired.");
		return { id, ownerId, size: upload.size, chunkSize: this.chunkSize, createdAt: upload.createdAt };
	}
}
