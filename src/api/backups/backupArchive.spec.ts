import { randomBytes } from "node:crypto";
import { appendFileSync, chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, truncateSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BackupCorruptError, BackupPassphraseError, CHUNK_SIZE, extractArchive, readArchiveHeader, writeArchive } from "./backupArchive.js";

let root: string;
let sources: Parameters<typeof writeArchive>[0]["sources"];
const big = randomBytes(CHUNK_SIZE * 3 + 123);
const PASS = "correct horse battery";

beforeAll(() => {
	mkdirSync("node_modules/.cache", { recursive: true });
	root = mkdtempSync(join(process.cwd(), "node_modules/.cache/flxbak-"));
	const fix = join(root, "fix");
	for (const dir of ["cfg", "sec", "cache/sub", "cache/empty"]) {
		mkdirSync(join(fix, dir), { recursive: true });
	}
	writeFileSync(join(fix, "dump.bin"), randomBytes(CHUNK_SIZE + 5));
	writeFileSync(join(fix, "cfg/flixer-config.db"), "live");
	writeFileSync(join(fix, "cfg/flixer-config.db-wal"), "wal");
	writeFileSync(join(fix, "cfg/config.key"), "key");
	chmodSync(join(fix, "cfg/config.key"), 0o600);
	writeFileSync(join(fix, "cfg/snapshot.tmp"), "snapshot");
	writeFileSync(join(fix, "sec/token"), "secret");
	writeFileSync(join(fix, "cache/sub/big.bin"), big);
	writeFileSync(join(fix, "cache/" + "n".repeat(130) + ".txt"), "long");
	symlinkSync("sub/big.bin", join(fix, "cache/link"));
	sources = {
		database: join(fix, "dump.bin"),
		config: { dir: join(fix, "cfg"), exclude: (rel) => /^flixer-config\.db(-wal|-shm)?$/.test(rel), extra: [{ name: "flixer-config.db", file: join(fix, "cfg/snapshot.tmp") }] },
		secrets: { dir: join(fix, "sec") },
		cache: { dir: join(fix, "cache") },
	};
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

async function write(name: string, passphrase?: string) {
	const destination = join(root, name);
	const header = await writeArchive({ destination, sources, versions: { flixer: "1.0.0" }, passphrase });
	return { destination, header };
}

describe("backup archive", () => {
	it("round-trips a plain archive and skips symlinks", async () => {
		const { destination, header } = await write("plain.flxbak");
		expect(header.encrypted).toBe(false);
		expect(statSync(destination).mode & 0o777).toBe(0o600);
		const out = join(root, "out-plain");
		const { manifest } = await extractArchive(destination, out);
		expect(manifest).toMatchObject({ version: 1, components: ["database", "config", "secrets", "cache"], versions: { flixer: "1.0.0" }, cacheFiles: 2 });
		expect(readFileSync(join(out, "cache/sub/big.bin")).equals(big)).toBe(true);
		expect(readFileSync(join(out, "cache/" + "n".repeat(130) + ".txt"), "utf8")).toBe("long");
		expect(statSync(join(out, "cache/empty")).isDirectory()).toBe(true);
		expect(() => statSync(join(out, "cache/link"))).toThrow();
		expect(readFileSync(join(out, "config/flixer-config.db"), "utf8")).toBe("snapshot");
		expect(() => statSync(join(out, "config/flixer-config.db-wal"))).toThrow();
		expect(statSync(join(out, "config/config.key")).mode & 0o777).toBe(0o600);
	});

	it("round-trips an encrypted multi-chunk archive", async () => {
		const { destination, header } = await write("enc.flxbak", PASS);
		expect(header.encrypted).toBe(true);
		expect(header.kdf).toMatchObject({ name: "pbkdf2-sha256", iterations: 600000 });
		const out = join(root, "out-enc");
		await extractArchive(destination, out, PASS);
		expect(readFileSync(join(out, "cache/sub/big.bin")).equals(big)).toBe(true);
		expect(statSync(destination).size).toBeGreaterThan(big.length);
	}, 30_000);

	it("reads the header without a passphrase", async () => {
		const { destination } = await write("hdr.flxbak", PASS);
		const { header } = await readArchiveHeader(destination);
		expect(header).toMatchObject({ encrypted: true, components: ["database", "config", "secrets", "cache"], versions: { flixer: "1.0.0" } });
	}, 30_000);

	it("rejects a wrong or missing passphrase", async () => {
		const { destination } = await write("wrong.flxbak", PASS);
		await expect(extractArchive(destination, join(root, "o1"), "not the passphrase")).rejects.toBeInstanceOf(BackupPassphraseError);
		await expect(extractArchive(destination, join(root, "o2"))).rejects.toBeInstanceOf(BackupPassphraseError);
	}, 30_000);

	it("detects tampering, truncation and trailing data", async () => {
		const { destination } = await write("tamper.flxbak", PASS);
		const original = readFileSync(destination);
		const flipped = Buffer.from(original);
		flipped[flipped.length - 40] ^= 0xff;
		writeFileSync(join(root, "flipped.flxbak"), flipped);
		await expect(extractArchive(join(root, "flipped.flxbak"), join(root, "o3"), PASS)).rejects.toBeInstanceOf(BackupCorruptError);

		writeFileSync(join(root, "short.flxbak"), original.subarray(0, original.length - 1000));
		await expect(extractArchive(join(root, "short.flxbak"), join(root, "o4"), PASS)).rejects.toBeInstanceOf(BackupCorruptError);

		const cut = join(root, "cut.flxbak");
		writeFileSync(cut, original);
		truncateSync(cut, original.length - 1);
		await expect(extractArchive(cut, join(root, "o5"), PASS)).rejects.toBeInstanceOf(BackupCorruptError);

		const extra = join(root, "extra.flxbak");
		writeFileSync(extra, original);
		appendFileSync(extra, Buffer.from([1, 2, 3]));
		await expect(extractArchive(extra, join(root, "o6"), PASS)).rejects.toBeInstanceOf(BackupCorruptError);

		// The header is authenticated: changing it breaks every chunk even though it still parses.
		const edited = Buffer.from(original);
		const at = edited.indexOf("1.0.0");
		edited[at] = "2".charCodeAt(0);
		writeFileSync(join(root, "edited.flxbak"), edited);
		await expect(extractArchive(join(root, "edited.flxbak"), join(root, "o7"), PASS)).rejects.toBeInstanceOf(BackupCorruptError);
	}, 60_000);

	it("detects truncation of a plain archive", async () => {
		const { destination } = await write("plain-cut.flxbak");
		truncateSync(destination, statSync(destination).size - 2000);
		await expect(extractArchive(destination, join(root, "o8"))).rejects.toBeInstanceOf(BackupCorruptError);
	});

	it("rejects files that are not backups", async () => {
		writeFileSync(join(root, "junk.flxbak"), "not a backup at all");
		await expect(readArchiveHeader(join(root, "junk.flxbak"))).rejects.toBeInstanceOf(BackupCorruptError);
		writeFileSync(join(root, "empty.flxbak"), "");
		await expect(readArchiveHeader(join(root, "empty.flxbak"))).rejects.toBeInstanceOf(BackupCorruptError);
	});
});
