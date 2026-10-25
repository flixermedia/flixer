import { createCipheriv, createDecipheriv, createHmac, pbkdf2, randomBytes, timingSafeEqual } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, open, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, join, posix, resolve, sep } from "node:path";
import { Readable, Transform, type TransformCallback } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip, createGzip } from "node:zlib";
import tar from "tar-stream";

/*
 * The `.flxbak` format is shared with the flixer-updater (Go), which restores these files:
 *   "FLXBAK1\n" | uint32 BE header length | JSON header | body
 * The body is a tar.gz. When encrypted it is split in 64 KiB chunks, each framed as
 *   flag(1: final chunk) | uint32 BE sealed length | AES-256-GCM(ciphertext || tag)
 * with nonce = 4-byte prefix + 8-byte BE chunk counter and the exact header bytes as AAD.
 */
export const MAGIC = "FLXBAK1\n";
export const HEADER_LIMIT = 1 << 20;
export const CHUNK_SIZE = 64 << 10;
export const KDF_ITERATIONS = 600_000;
const GCM_TAG = 16;
const CHECK_LABEL = "flixer-backup-passphrase-check";

export const COMPONENTS = ["database", "config", "secrets", "cache"] as const;
export type BackupComponent = (typeof COMPONENTS)[number];

export class BackupCorruptError extends Error {
	constructor(message = "Backup is corrupt or unsupported.") {
		super(message);
	}
}

export class BackupPassphraseError extends Error {
	constructor() {
		super("The backup passphrase is incorrect.");
	}
}

export interface BackupKdf {
	name: string;
	iterations: number;
	salt: string;
	noncePrefix: string;
	check: string;
}

export interface BackupHeader {
	createdAt: string;
	components: BackupComponent[];
	encrypted: boolean;
	versions: Record<string, string>;
	kdf?: BackupKdf;
}

export interface BackupManifest {
	version: number;
	createdAt: string;
	components: string[];
	versions: Record<string, string>;
	databaseBytes: number;
	cacheFiles: number;
}

export interface DirectorySource {
	dir: string;
	/** Relative (forward slash) paths that are not archived. */
	exclude?: (relative: string) => boolean;
	/** Extra regular files stored at the given path relative to the component root. */
	extra?: { name: string; file: string }[];
}

export interface ArchiveSources {
	database?: string;
	config?: DirectorySource;
	secrets?: DirectorySource;
	cache?: DirectorySource;
}

export interface WriteArchiveOptions {
	destination: string;
	sources: ArchiveSources;
	versions?: Record<string, string>;
	passphrase?: string;
	onStep?: (step: "archive-config" | "archive-secrets" | "archive-cache" | "encrypt-finish") => void;
	warn?: (message: string) => void;
}

function deriveKey(passphrase: string, salt: Buffer): Promise<Buffer> {
	return new Promise((done, fail) => pbkdf2(passphrase, salt, KDF_ITERATIONS, 32, "sha256", (error, key) => (error ? fail(error) : done(key))));
}

function passphraseCheck(key: Buffer): Buffer {
	return createHmac("sha256", key).update(CHECK_LABEL).digest();
}

function nonceFor(prefix: Buffer, counter: number): Buffer {
	const nonce = Buffer.alloc(12);
	prefix.copy(nonce, 0);
	nonce.writeBigUInt64BE(BigInt(counter), 4);
	return nonce;
}

function decodeBase64(value: unknown, length: number): Buffer | null {
	if (typeof value !== "string") {
		return null;
	}
	const bytes = Buffer.from(value, "base64");
	return bytes.length === length && bytes.toString("base64") === value ? bytes : null;
}

/** Validates a parsed header exactly like the updater does. */
function validateHeader(parsed: unknown): BackupHeader {
	if (typeof parsed !== "object" || parsed === null) {
		throw new BackupCorruptError();
	}
	const h = parsed as Partial<BackupHeader>;
	if (!Array.isArray(h.components) || h.components.length === 0 || new Set(h.components).size !== h.components.length || !h.components.every((c) => (COMPONENTS as readonly string[]).includes(c))) {
		throw new BackupCorruptError();
	}
	if (typeof h.createdAt !== "string" || Number.isNaN(Date.parse(h.createdAt))) {
		throw new BackupCorruptError();
	}
	if (typeof h.encrypted !== "boolean") {
		throw new BackupCorruptError();
	}
	const versions = h.versions ?? {};
	if (typeof versions !== "object" || Array.isArray(versions) || !Object.values(versions).every((v) => typeof v === "string")) {
		throw new BackupCorruptError();
	}
	if (h.encrypted) {
		const kdf = h.kdf;
		if (!kdf || kdf.name !== "pbkdf2-sha256" || kdf.iterations !== KDF_ITERATIONS || !decodeBase64(kdf.salt, 16) || !decodeBase64(kdf.noncePrefix, 4) || !decodeBase64(kdf.check, 32)) {
			throw new BackupCorruptError();
		}
	}
	return { ...(h as BackupHeader), versions: { ...versions } };
}

export interface ReadHeaderResult {
	header: BackupHeader;
	/** The exact header bytes; they are the AAD of every encrypted chunk. */
	raw: Buffer;
	/** Where the body starts. */
	bodyOffset: number;
}

/** Reads only the unencrypted prefix of an archive. Never reads the body. */
export async function readArchiveHeader(file: string): Promise<ReadHeaderResult> {
	const handle = await open(file, "r");
	try {
		const prefix = Buffer.alloc(MAGIC.length + 4);
		const { bytesRead } = await handle.read(prefix, 0, prefix.length, 0);
		if (bytesRead !== prefix.length || prefix.subarray(0, MAGIC.length).toString("latin1") !== MAGIC) {
			throw new BackupCorruptError();
		}
		const length = prefix.readUInt32BE(MAGIC.length);
		if (length === 0 || length > HEADER_LIMIT) {
			throw new BackupCorruptError();
		}
		const raw = Buffer.alloc(length);
		const read = await handle.read(raw, 0, length, prefix.length);
		if (read.bytesRead !== length) {
			throw new BackupCorruptError();
		}
		let parsed: unknown;
		try {
			parsed = JSON.parse(raw.toString("utf8"));
		} catch {
			throw new BackupCorruptError();
		}
		return { header: validateHeader(parsed), raw, bodyOffset: prefix.length + length };
	} finally {
		await handle.close();
	}
}

/** Buffers into 64 KiB plaintext chunks and seals each one; the last chunk (possibly empty) carries the final flag. */
class EncryptChunks extends Transform {
	private pending: Buffer[] = [];
	private pendingBytes = 0;
	private counter = 0;

	constructor(
		private readonly key: Buffer,
		private readonly prefix: Buffer,
		private readonly aad: Buffer,
	) {
		super();
	}

	private seal(plain: Buffer, final: boolean): Buffer {
		const cipher = createCipheriv("aes-256-gcm", this.key, nonceFor(this.prefix, this.counter++), { authTagLength: GCM_TAG });
		cipher.setAAD(this.aad);
		const sealed = Buffer.concat([cipher.update(plain), cipher.final(), cipher.getAuthTag()]);
		const frame = Buffer.alloc(5);
		frame[0] = final ? 1 : 0;
		frame.writeUInt32BE(sealed.length, 1);
		return Buffer.concat([frame, sealed]);
	}

	override _transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback): void {
		try {
			this.pending.push(chunk);
			this.pendingBytes += chunk.length;
			if (this.pendingBytes >= CHUNK_SIZE) {
				const all = Buffer.concat(this.pending);
				let offset = 0;
				for (; all.length - offset >= CHUNK_SIZE; offset += CHUNK_SIZE) {
					this.push(this.seal(all.subarray(offset, offset + CHUNK_SIZE), false));
				}
				const rest = all.subarray(offset);
				this.pending = rest.length > 0 ? [rest] : [];
				this.pendingBytes = rest.length;
			}
			callback();
		} catch (error) {
			callback(error as Error);
		}
	}

	override _flush(callback: TransformCallback): void {
		try {
			this.push(this.seal(Buffer.concat(this.pending), true));
			callback();
		} catch (error) {
			callback(error as Error);
		}
	}
}

/** Parses and authenticates the chunk framing; fails on tampering, reordering, truncation and trailing bytes. */
class DecryptChunks extends Transform {
	private buffer: Buffer = Buffer.alloc(0);
	private counter = 0;
	private finished = false;

	constructor(
		private readonly key: Buffer,
		private readonly prefix: Buffer,
		private readonly aad: Buffer,
	) {
		super();
	}

	override _transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback): void {
		try {
			if (this.finished) {
				throw new BackupCorruptError();
			}
			this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk]);
			for (;;) {
				if (this.buffer.length < 5) {
					break;
				}
				const flag = this.buffer[0]!;
				const size = this.buffer.readUInt32BE(1);
				if ((flag !== 0 && flag !== 1) || size < GCM_TAG || size > CHUNK_SIZE + GCM_TAG) {
					throw new BackupCorruptError();
				}
				if (this.buffer.length < 5 + size) {
					break;
				}
				const sealed = this.buffer.subarray(5, 5 + size);
				this.buffer = this.buffer.subarray(5 + size);
				const decipher = createDecipheriv("aes-256-gcm", this.key, nonceFor(this.prefix, this.counter++), { authTagLength: GCM_TAG });
				decipher.setAAD(this.aad);
				decipher.setAuthTag(sealed.subarray(size - GCM_TAG));
				let plain: Buffer;
				try {
					plain = Buffer.concat([decipher.update(sealed.subarray(0, size - GCM_TAG)), decipher.final()]);
				} catch {
					throw new BackupCorruptError();
				}
				this.push(plain);
				if (flag === 1) {
					this.finished = true;
					if (this.buffer.length > 0) {
						throw new BackupCorruptError();
					}
					break;
				}
			}
			callback();
		} catch (error) {
			callback(error as Error);
		}
	}

	override _flush(callback: TransformCallback): void {
		callback(this.finished && this.buffer.length === 0 ? null : new BackupCorruptError());
	}
}

/** Opens the tar.gz body of an archive, decrypting it when needed. Throws BackupPassphraseError before reading any data. */
export async function openArchiveBody(file: string, passphrase?: string): Promise<{ header: BackupHeader; body: Readable }> {
	const { header, raw, bodyOffset } = await readArchiveHeader(file);
	const source = createReadStream(file, { start: bodyOffset });
	if (!header.encrypted) {
		return { header, body: source };
	}
	const kdf = header.kdf!;
	const key = await deriveKey(passphrase ?? "", decodeBase64(kdf.salt, 16)!);
	const expected = decodeBase64(kdf.check, 32)!;
	const actual = passphraseCheck(key);
	if (!passphrase || !timingSafeEqual(expected, actual)) {
		source.destroy();
		throw new BackupPassphraseError();
	}
	const decrypt = new DecryptChunks(key, decodeBase64(kdf.noncePrefix, 4)!, raw);
	source.on("error", (error) => decrypt.destroy(error));
	return { header, body: source.pipe(decrypt) };
}

export function safeEntryName(name: string): string {
	const clean = posix.normalize(name);
	if (name === "" || name.includes("\\") || name.startsWith("/") || /^[A-Za-z]:/.test(name) || clean !== name || clean === "." || clean === ".." || clean.startsWith("../")) {
		throw new BackupCorruptError();
	}
	return clean;
}

/**
 * Validates and extracts an archive beneath `destination`, the way the updater's restore does. Used by tests and
 * tooling; production restores are done by the updater.
 */
export async function extractArchive(source: string, destination: string, passphrase?: string): Promise<{ header: BackupHeader; manifest: BackupManifest }> {
	const { header, body } = await openArchiveBody(source, passphrase);
	const root = resolve(destination);
	await mkdir(root, { recursive: true });
	let manifest: BackupManifest | undefined;
	const extract = tar.extract();
	const work = (async () => {
		for await (const entry of extract) {
			const name = safeEntryName(entry.header.name);
			if (entry.header.type !== "file" && entry.header.type !== "directory") {
				throw new BackupCorruptError();
			}
			if (name === "manifest.json") {
				const chunks: Buffer[] = [];
				for await (const chunk of entry) {
					chunks.push(chunk as Buffer);
				}
				manifest = JSON.parse(Buffer.concat(chunks).toString("utf8")) as BackupManifest;
				continue;
			}
			const parts = name.split("/");
			const component = name === "database.dump" ? "database" : parts[0]!;
			if ((name !== "database.dump" && parts.length < 2) || !(header.components as string[]).includes(component)) {
				throw new BackupCorruptError();
			}
			const target = resolve(root, ...parts);
			if (!target.startsWith(root + sep)) {
				throw new BackupCorruptError();
			}
			if (entry.header.type === "directory") {
				await mkdir(target, { recursive: true });
				entry.resume();
				continue;
			}
			await mkdir(dirname(target), { recursive: true });
			await pipeline(entry as unknown as Readable, createWriteStream(target, { flags: "wx", mode: (entry.header.mode ?? 0o600) & 0o600 || 0o600 }));
		}
	})();
	await Promise.all([pipeline(body, createGunzip(), extract as unknown as NodeJS.WritableStream).catch((error) => {
		throw error instanceof BackupCorruptError || error instanceof BackupPassphraseError ? error : new BackupCorruptError();
	}), work]);
	if (!manifest || manifest.version !== 1 || manifest.createdAt !== header.createdAt) {
		throw new BackupCorruptError();
	}
	return { header, manifest };
}

type Pack = ReturnType<typeof tar.pack>;

interface Evented {
	once: (event: string, listener: (...args: unknown[]) => void) => unknown;
	removeListener: (event: string, listener: (...args: unknown[]) => void) => unknown;
}

function drained(stream: Evented): Promise<void> {
	return new Promise((done, fail) => {
		const cleanup = () => {
			stream.removeListener("drain", onDrain);
			stream.removeListener("close", onClose);
			stream.removeListener("error", onError);
		};
		const onDrain = () => (cleanup(), done());
		const onClose = () => (cleanup(), fail(new Error("The archive stream closed early.")));
		const onError = (error: unknown) => (cleanup(), fail(error instanceof Error ? error : new Error(String(error))));
		stream.once("drain", onDrain);
		stream.once("close", onClose);
		stream.once("error", onError);
	});
}

/** Reads exactly `size` bytes: zero padded if the file shrank, truncated if it grew, so the tar framing stays valid. */
async function* exactBytes(file: string, name: string, size: number, warn: (message: string) => void): AsyncGenerator<Buffer> {
	const handle = await open(file, "r");
	try {
		let remaining = size;
		let position = 0;
		let shrank = false;
		while (remaining > 0) {
			const buffer = Buffer.alloc(Math.min(CHUNK_SIZE, remaining));
			const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
			if (bytesRead === 0) {
				shrank = true;
				yield Buffer.alloc(remaining);
				break;
			}
			position += bytesRead;
			remaining -= bytesRead;
			yield bytesRead === buffer.length ? buffer : buffer.subarray(0, bytesRead);
		}
		if (shrank) {
			warn(`${name} shrank while it was being archived; the rest was zero filled.`);
		} else if ((await handle.read(Buffer.alloc(1), 0, 1, position)).bytesRead > 0) {
			warn(`${name} grew while it was being archived; the extra bytes were left out.`);
		}
	} finally {
		await handle.close();
	}
}

async function addFile(pack: Pack, file: string, name: string, warn: (message: string) => void): Promise<void> {
	safeEntryName(name);
	const handle = await open(file, "r");
	let info;
	try {
		info = await handle.stat();
	} finally {
		await handle.close();
	}
	const mode = (info.mode & 0o777 & 0o600) === 0 ? 0o600 : info.mode & 0o777;
	const entry = pack.entry({ name, size: info.size, mode, type: "file", mtime: new Date() });
	const failed = new Promise<never>((_, fail) => entry.once("error", fail));
	const writing = (async () => {
		for await (const chunk of exactBytes(file, name, info.size, warn)) {
			if (!entry.write(chunk)) {
				await drained(entry);
			}
		}
		await new Promise<void>((done) => (entry.once("finish", () => done()), entry.end(Buffer.alloc(0))));
	})();
	await Promise.race([writing, failed]);
}

interface WalkItem {
	relative: string;
	file: string;
	directory: boolean;
}

/** Depth first, sorted; regular files and directories only. Symlinks and special files are skipped. */
async function* walk(root: string, relative = "", skipped: (relative: string) => void = () => {}): AsyncGenerator<WalkItem> {
	const entries = (await readdir(join(root, relative), { withFileTypes: true })).sort((a, b) => (a.name < b.name ? -1 : 1));
	for (const entry of entries) {
		const rel = relative ? `${relative}/${entry.name}` : entry.name;
		if (entry.isDirectory()) {
			yield { relative: rel, file: join(root, rel), directory: true };
			yield* walk(root, rel, skipped);
		} else if (entry.isFile()) {
			yield { relative: rel, file: join(root, rel), directory: false };
		} else {
			skipped(rel);
		}
	}
}

async function countFiles(source: DirectorySource | undefined): Promise<number> {
	if (!source) {
		return 0;
	}
	let count = 0;
	for await (const item of walk(source.dir)) {
		if (!item.directory && !source.exclude?.(item.relative)) {
			count++;
		}
	}
	return count;
}

async function addDirectory(pack: Pack, source: DirectorySource, prefix: string, warn: (message: string) => void): Promise<void> {
	const skipped = (rel: string) => warn(`Skipped ${prefix}/${rel}: not a regular file or directory.`);
	const extras = new Map((source.extra ?? []).map((extra) => [extra.name, extra.file]));
	for await (const item of walk(source.dir, "", skipped)) {
		const name = `${prefix}/${item.relative}`;
		if (item.directory) {
			if (!source.exclude?.(item.relative)) {
				pack.entry({ name, type: "directory", mode: 0o700, mtime: new Date() });
			}
		} else if (!source.exclude?.(item.relative) && !extras.has(item.relative)) {
			await addFile(pack, item.file, name, warn);
		}
	}
	for (const [relative, file] of extras) {
		await addFile(pack, file, `${prefix}/${relative}`, warn);
	}
}

/**
 * Writes a `.flxbak` archive to `destination` (the caller renames partial files into place). Everything streams with
 * backpressure: files are read in 64 KiB pieces through tar, gzip and the optional encryption into the output file.
 */
export async function writeArchive(options: WriteArchiveOptions): Promise<BackupHeader> {
	const { destination, sources, passphrase } = options;
	const warn = options.warn ?? (() => {});
	const components = COMPONENTS.filter((component) => sources[component] !== undefined);
	const versions = { ...(options.versions ?? {}) };
	const createdAt = new Date().toISOString();
	const header: BackupHeader = { createdAt, components: [...components], encrypted: Boolean(passphrase), versions };
	let key: Buffer | undefined;
	let prefix: Buffer | undefined;
	if (passphrase) {
		const salt = randomBytes(16);
		prefix = randomBytes(4);
		key = await deriveKey(passphrase, salt);
		header.kdf = { name: "pbkdf2-sha256", iterations: KDF_ITERATIONS, salt: salt.toString("base64"), noncePrefix: prefix.toString("base64"), check: passphraseCheck(key).toString("base64") };
	}
	const headerBytes = Buffer.from(JSON.stringify(header), "utf8");
	if (headerBytes.length > HEADER_LIMIT) {
		throw new Error("The backup header is too large.");
	}
	const manifest: BackupManifest = {
		version: 1,
		createdAt,
		components: [...components],
		versions,
		databaseBytes: sources.database ? (await stat(sources.database)).size : 0,
		cacheFiles: await countFiles(sources.cache),
	};
	const prelude = Buffer.alloc(MAGIC.length + 4);
	prelude.write(MAGIC, "latin1");
	prelude.writeUInt32BE(headerBytes.length, MAGIC.length);
	await writeFile(destination, Buffer.concat([prelude, headerBytes]), { mode: 0o600 });

	const pack = tar.pack();
	const producer = (async () => {
		try {
			const manifestBytes = Buffer.from(JSON.stringify(manifest), "utf8");
			pack.entry({ name: "manifest.json", mode: 0o600, mtime: new Date() }, manifestBytes);
			for (const component of components) {
				if (component === "database") {
					await addFile(pack, sources.database!, "database.dump", warn);
				} else {
					options.onStep?.(`archive-${component}`);
					await addDirectory(pack, sources[component]!, component, warn);
				}
			}
			options.onStep?.("encrypt-finish");
			pack.finalize();
		} catch (error) {
			pack.destroy(error instanceof Error ? error : new Error(String(error)));
		}
	})();
	const out = createWriteStream(destination, { flags: "a", mode: 0o600 });
	const stages: (NodeJS.ReadableStream | NodeJS.WritableStream | Transform)[] = [Readable.from(pack as AsyncIterable<Buffer>), createGzip()];
	if (key && prefix) {
		stages.push(new EncryptChunks(key, prefix, headerBytes));
	}
	await pipeline([...stages, out] as never);
	await producer;
	const handle = await open(destination, "r+");
	try {
		await handle.sync();
	} finally {
		await handle.close();
	}
	return header;
}
