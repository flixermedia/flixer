import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setAppConfig } from "../../config/store/appConfig.js";
import { extractArchive, writeArchive } from "./backupArchive.js";
import { BackupService, backupFileName, isBackupDue, isBackupName, signDownload, type BackupRun } from "./backupService.js";

describe("isBackupName", () => {
	it("accepts archive names only", () => {
		expect(isBackupName("flixer-2026-10-24T22-20-40-123Z.flxbak")).toBe(true);
		expect(isBackupName("flixer-2026-10-24T22-20-40-123Z.dump")).toBe(false);
		expect(isBackupName("../flixer-2026.flxbak")).toBe(false);
		expect(isBackupName("flixer-1/../../etc.flxbak")).toBe(false);
		expect(isBackupName("other.flxbak")).toBe(false);
	});
});

describe("isBackupDue", () => {
	const now = Date.parse("2026-10-25T03:00:00Z");

	it("is never due when the schedule is off", () => {
		expect(isBackupDue("off", null, now)).toBe(false);
	});

	it("is due straight away when nothing has run yet", () => {
		expect(isBackupDue("daily", null, now)).toBe(true);
		expect(isBackupDue("weekly", "garbage", now)).toBe(true);
	});

	it("waits for the period, allowing for the hourly check", () => {
		expect(isBackupDue("daily", "2026-10-25T00:00:00Z", now)).toBe(false);
		expect(isBackupDue("daily", "2026-10-24T03:30:00Z", now)).toBe(true);
		expect(isBackupDue("weekly", "2026-10-20T03:00:00Z", now)).toBe(false);
		expect(isBackupDue("weekly", "2026-10-18T03:00:00Z", now)).toBe(true);
	});
});

describe("signDownload", () => {
	it("binds the signature to the file name, the expiry and the secret", () => {
		const base = signDownload("secret", "flixer-1.flxbak", 1000);
		expect(base).toMatch(/^[0-9a-f]{64}$/);
		expect(signDownload("secret", "flixer-1.flxbak", 1000)).toBe(base);
		expect(signDownload("secret", "flixer-2.flxbak", 1000)).not.toBe(base);
		expect(signDownload("secret", "flixer-1.flxbak", 1001)).not.toBe(base);
		expect(signDownload("other", "flixer-1.flxbak", 1000)).not.toBe(base);
	});
});

describe("backupFileName", () => {
	it("uses the compact UTC format and avoids taken names", () => {
		const now = new Date("2026-10-24T22:20:40.123Z");
		expect(backupFileName(now, () => false)).toBe("flixer-20261024T222040Z.flxbak");
		expect(isBackupName(backupFileName(now, () => false))).toBe(true);
		const taken = new Set(["flixer-20261024T222040Z.flxbak"]);
		const next = backupFileName(now, (name) => taken.has(name));
		expect(next).toBe("flixer-20261024T222040-1Z.flxbak");
		expect(isBackupName(next)).toBe(true);
	});
});

describe("BackupService", () => {
	vi.setConfig({ testTimeout: 30_000 });
	const base = join(process.cwd(), "node_modules/.cache");
	let root: string;
	let settings: Record<string, unknown>;
	let updater: { token: () => string | undefined; call: ReturnType<typeof vi.fn> };
	let service: BackupService;
	let dumped: string[];

	const dir = () => join(root, "backups");
	const files = () => readdirSync(dir()).sort();
	const waitDone = async (run: BackupRun) => {
		for (let i = 0; i < 400 && (await service.status()).run?.id === run.id && (await service.status()).run?.status === "running"; i++) {
			await new Promise((done) => setTimeout(done, 25));
		}
		return (await service.status()).run!;
	};

	beforeEach(() => {
		mkdirSync(base, { recursive: true });
		root = mkdtempSync(join(base, "svc-"));
		for (const sub of ["config", "secrets", "metadata/sub"]) {
			mkdirSync(join(root, sub), { recursive: true });
		}
		writeFileSync(join(root, "secrets/app-secret"), "tokensecret");
		writeFileSync(join(root, "metadata/sub/a.txt"), "meta");
		process.env.BACKUP_DIR = dir();
		process.env.CONFIG_DIR = join(root, "config");
		process.env.METADATA_DIR = join(root, "metadata");
		process.env.APP_SECRET_FILE = join(root, "secrets/app-secret");
		process.env.DATABASE_URL = "postgres://user:pw@db:5432/flixer";
		delete process.env.BACKUP_PASSPHRASE_FILE;
		setAppConfig(undefined);
		settings = { backups_keep: 7 };
		updater = { token: () => "token", call: vi.fn().mockRejectedValue(new Error("down")) };
		dumped = [];
		const dataSource = { getRepository: () => ({ findOneBy: async ({ key }: { key: string }) => (key in settings ? { value: settings[key] } : null), update: async () => undefined }) };
		service = new BackupService(dataSource as never, updater as never, { send: vi.fn() } as never);
		service.dumpDatabase = async (url, file) => {
			dumped.push(url);
			writeFileSync(file, "PGDMP-fake");
		};
	});

	afterEach(() => {
		setAppConfig(undefined);
		rmSync(root, { recursive: true, force: true });
	});

	it("creates a restorable archive through the run state machine", async () => {
		const run = await service.create();
		expect(run).toMatchObject({ kind: "backup", status: "running" });
		const done = await waitDone(run);
		expect(done.status).toBe("succeeded");
		expect(done.steps!.map((step) => step.name)).toEqual(["dump-database", "archive-config", "archive-secrets", "archive-metadata", "encrypt-finish", "prune"]);
		expect(done.steps!.every((step) => step.status === "succeeded" && step.finishedAt)).toBe(true);
		expect(done.encrypted).toBe(false);
		expect(dumped).toEqual(["postgres://user:pw@db:5432/flixer"]);
		expect(files().every((name) => isBackupName(name))).toBe(true);
		const [entry] = await service.list();
		expect(entry).toMatchObject({ encrypted: false, components: ["database", "config", "secrets", "metadata"], versions: { flixer: expect.any(String) } });
		const out = join(root, "extracted");
		await extractArchive(join(dir(), entry!.name), out);
		expect(readFileSync(join(out, "database.dump"), "utf8")).toBe("PGDMP-fake");
		expect(readFileSync(join(out, "metadata/sub/a.txt"), "utf8")).toBe("meta");
		expect(readFileSync(join(out, "secrets/app-secret"), "utf8")).toBe("tokensecret");
		expect(statSync(join(out, "config/flixer-config.db")).size).toBeGreaterThan(0);
		expect(readdirSync(join(out, "config")).some((name) => name.endsWith("-wal"))).toBe(false);
	});

	it("encrypts when a passphrase is saved and never exposes it", async () => {
		await service.setPassphrase("a long passphrase");
		const file = join(dir(), ".passphrase");
		expect(readFileSync(file, "utf8")).toBe("a long passphrase");
		expect(statSync(file).mode & 0o777).toBe(0o600);
		const run = await service.create();
		const done = await waitDone(run);
		expect(done.status).toBe("succeeded");
		expect(done.encrypted).toBe(true);
		expect(JSON.stringify(done)).not.toContain("a long passphrase");
		const status = await service.status();
		expect(status.passphraseSet).toBe(true);
		expect(status.backups[0]!.encrypted).toBe(true);
		expect(JSON.stringify(status)).not.toContain("a long passphrase");
		await service.clearPassphrase();
		expect((await service.status()).passphraseSet).toBe(false);
	}, 30_000);

	it("validates passphrase length", async () => {
		await expect(service.setPassphrase("short")).rejects.toThrow(/between 8 and 256/);
		await expect(service.setPassphrase(42)).rejects.toThrow(/between 8 and 256/);
	});

	it("rejects a second backup while one runs", async () => {
		let release!: () => void;
		service.dumpDatabase = (_url, file) => new Promise<void>((done) => { release = () => { writeFileSync(file, "x"); done(); }; });
		const run = await service.create();
		for (let i = 0; i < 200 && !release; i++) {
			await new Promise((done) => setTimeout(done, 10));
		}
		await expect(service.create()).rejects.toThrow(/already running/);
		await expect(service.restore("flixer-20260101T000000Z.flxbak", undefined)).rejects.toThrow();
		release();
		expect((await waitDone(run)).status).toBe("succeeded");
	});

	it("refuses to back up while the updater is restoring", async () => {
		updater.call.mockImplementation(async () => new Response(JSON.stringify({ state: { run: { kind: "restore", status: "running" } } })));
		await expect(service.create()).rejects.toThrow(/restore is running/);
		expect((await service.status()).run).toMatchObject({ kind: "restore" });
		await expect(service.remove("flixer-20260101T000000Z.flxbak")).rejects.toThrow(/restore is running/);
	});

	it("captures a failure and leaves no partial files", async () => {
		service.dumpDatabase = async (_url, file) => {
			writeFileSync(file, "half");
			throw new Error("pg_dump failed (exit 1): boom");
		};
		const done = await waitDone(await service.create());
		expect(done.status).toBe("failed");
		expect(done.error).toContain("boom");
		expect(done.steps!.at(-1)).toMatchObject({ name: "dump-database", status: "failed" });
		expect(files()).toEqual([]);
		// A failed run does not block the next one.
		service.dumpDatabase = async (_url, file) => writeFileSync(file, "ok");
		expect((await waitDone(await service.create())).status).toBe("succeeded");
	});

	it("fails cleanly when the archive step breaks", async () => {
		rmSync(join(root, "metadata/sub"), { recursive: true });
		process.env.METADATA_DIR = join(root, "missing");
		const done = await waitDone(await service.create());
		expect(done.status).toBe("succeeded");
		const [entry] = await service.list();
		expect(entry!.components).not.toContain("metadata");
		expect(done.log.some((line) => line.includes("metadata folder was not found"))).toBe(true);
	});

	it("lists only readable archives, newest first, and prunes only .flxbak", async () => {
		mkdirSync(dir(), { recursive: true });
		const source = join(root, "d.bin");
		writeFileSync(source, "d");
		for (const name of ["flixer-20260101T000000Z.flxbak", "flixer-20260102T000000Z.flxbak", "flixer-20260103T000000Z.flxbak"]) {
			await writeArchive({ destination: join(dir(), name), sources: { database: source } });
		}
		utimesSync(join(dir(), "flixer-20260101T000000Z.flxbak"), 1000, 1000);
		utimesSync(join(dir(), "flixer-20260102T000000Z.flxbak"), 2000, 2000);
		utimesSync(join(dir(), "flixer-20260103T000000Z.flxbak"), 3000, 3000);
		writeFileSync(join(dir(), "flixer-2026-10-24T22-20-40-123Z.dump"), "legacy");
		writeFileSync(join(dir(), "flixer-20260104T000000Z.flxbak"), "corrupt");
		writeFileSync(join(dir(), "notes.txt"), "x");
		writeFileSync(join(dir(), ".dump-abc.tmp"), "x");
		const listed = await service.list();
		expect(listed).toHaveLength(3);
		expect(listed.map((entry) => entry.name)).toEqual(["flixer-20260103T000000Z.flxbak", "flixer-20260102T000000Z.flxbak", "flixer-20260101T000000Z.flxbak"]);
		rmSync(join(dir(), "flixer-20260104T000000Z.flxbak"));
		await service.prune(2);
		expect(files()).toEqual(["flixer-2026-10-24T22-20-40-123Z.dump", "flixer-20260102T000000Z.flxbak", "flixer-20260103T000000Z.flxbak", ".dump-abc.tmp", "notes.txt"].sort());
	});

	it("applies retention after a backup", async () => {
		settings.backups_keep = 1;
		await waitDone(await service.create());
		await new Promise((done) => setTimeout(done, 1100));
		await waitDone(await service.create());
		expect(files().filter(isBackupName)).toHaveLength(1);
	});

	it("sweeps stale partial files at startup", async () => {
		mkdirSync(join(dir(), ".uploads"), { recursive: true });
		for (const name of [".flixer-backup-abc123.tmp", ".dump-abc123.tmp", ".config-abc123.tmp", ".uploads/leftover"]) {
			writeFileSync(join(dir(), name), "x");
		}
		writeFileSync(join(dir(), "flixer-20260101T000000Z.dump"), "legacy");
		await service.$onInit();
		expect(files()).toEqual([".uploads", "flixer-20260101T000000Z.dump"]);
		expect(readdirSync(join(dir(), ".uploads"))).toEqual([]);
	});

	it("validates names on delete and download", async () => {
		await expect(service.remove("../etc/passwd")).rejects.toThrow(/not a valid backup name/);
		await expect(service.remove("flixer-1.dump")).rejects.toThrow(/not a valid backup name/);
		await expect(service.remove("flixer-20260101T000000Z.flxbak")).rejects.toThrow(/no longer exists/);
		mkdirSync(dir(), { recursive: true });
		writeFileSync(join(dir(), "flixer-20260101T000000Z.flxbak"), "x");
		await service.remove("flixer-20260101T000000Z.flxbak");
		expect(files()).toEqual([]);
	});

	it("rejects an upload that is not a backup and accepts a real one", async () => {
		mkdirSync(join(dir(), ".uploads"), { recursive: true });
		const junk = join(dir(), ".uploads", "junk");
		writeFileSync(junk, "hello");
		await expect(service.upload(junk)).rejects.toThrow(/not a Flixer backup/);
		expect(files().filter(isBackupName)).toEqual([]);

		const valid = join(dir(), ".uploads", "valid");
		const source = join(root, "d.bin");
		writeFileSync(source, "d");
		await writeArchive({ destination: valid, sources: { database: source }, versions: { flixer: "0.9.0" } });
		const entry = await service.upload(valid);
		expect(isBackupName(entry.name)).toBe(true);
		expect(entry).toMatchObject({ encrypted: false, components: ["database"], versions: { flixer: "0.9.0" } });
		expect(() => statSync(valid)).toThrow();
		expect(statSync(join(dir(), entry.name)).mode & 0o777).toBe(0o600);
	});

	it("serves the list, schedule and passphrase while the updater is down", async () => {
		settings.backups_schedule = "daily";
		const status = await service.status();
		expect(status).toMatchObject({ updaterReachable: false, canRestore: false, passphraseSet: false, schedule: "daily", keep: 7, run: null, backups: [] });
		expect(status).not.toHaveProperty("canManage");
	});

	it("reports canRestore when the updater answers", async () => {
		updater.call.mockResolvedValue(new Response(JSON.stringify({ state: { run: null } })));
		expect(await service.status()).toMatchObject({ updaterReachable: true, canRestore: true });
	});

	describe("restore", () => {
		const name = "flixer-20260101T000000Z.flxbak";

		it("needs the file to exist locally", async () => {
			await expect(service.restore(name, undefined)).rejects.toThrow(/no longer exists/);
		});

		it("maps updater errors", async () => {
			mkdirSync(dir(), { recursive: true });
			writeFileSync(join(dir(), name), "x");
			updater.call.mockResolvedValueOnce(new Response(JSON.stringify({ error: "busy now", code: "busy" }), { status: 409 }));
			await expect(service.restore(name, undefined)).rejects.toMatchObject({ status: 409 });
			updater.call.mockResolvedValueOnce(new Response(JSON.stringify({ error: "backup passphrase is incorrect", code: "bad_passphrase" }), { status: 400 }));
			await expect(service.restore(name, "nope")).rejects.toMatchObject({ status: 400, message: "backup passphrase is incorrect" });
			updater.call.mockResolvedValueOnce(new Response(JSON.stringify({ id: "r1", kind: "restore", status: "running" }), { status: 202 }));
			await expect(service.restore(name, "pw")).resolves.toMatchObject({ kind: "restore" });
			const [path, init] = updater.call.mock.calls.at(-1)!;
			expect(path).toBe(`/v1/backups/${name}/restore`);
			expect(JSON.parse(init.body)).toEqual({ databaseUrl: "postgres://user:pw@db:5432/flixer", passphrase: "pw" });
		});
	});
});
