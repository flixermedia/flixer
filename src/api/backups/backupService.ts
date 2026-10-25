import { Inject, Injectable, logger } from "@tsed/di";
import { BadRequest, Conflict, NotFound } from "@tsed/exceptions";
import { spawn } from "node:child_process";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { createReadStream, type ReadStream } from "node:fs";
import { chmod, copyFile, mkdir, readdir, readFile, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { DataSource, IsNull } from "typeorm";
import { version as flixerVersion } from "../../config/config.js";
import { appConfig, configDirectory } from "../../config/store/appConfig.js";
import { DefaultDataSource } from "../../datasources/defaultDataSource.datasource.js";
import { Setting } from "../../entities/setting.entity.js";
import { User } from "../../entities/user.entity.js";
import { NotificationService } from "../notifications/notificationService.js";
import { UpdaterClient } from "../updates/updaterClient.js";
import { type ArchiveSources, type BackupHeader, readArchiveHeader, writeArchive } from "./backupArchive.js";

export const BACKUP_NAME_PATTERN = /^flixer-[0-9TZ-]+\.flxbak$/;
export type BackupSchedule = "off" | "daily" | "weekly";

const CHECK_INTERVAL_MS = 60 * 60_000;
const SCHEDULE_INTERVAL_MS: Record<Exclude<BackupSchedule, "off">, number> = { daily: 24 * 60 * 60_000, weekly: 7 * 24 * 60 * 60_000 };
// The hourly check would otherwise drift a run later each period.
const SCHEDULE_SLACK_MS = 90 * 60_000;
const DOWNLOAD_LINK_TTL_MS = 5 * 60_000;
const DEFAULT_KEEP = 7;
const UPDATER_STATUS_TIMEOUT_MS = 3_000;
const MAX_LOG_LINES = 200;
const PARTIAL_PATTERN = /^\.(flixer-backup|dump|config)-[A-Za-z0-9]+\.tmp$/;

export interface BackupEntry {
	name: string;
	size: number;
	createdAt: string;
	encrypted: boolean;
	components: string[];
	versions: Record<string, string>;
}

export type BackupStepName = "dump-database" | "archive-config" | "archive-secrets" | "archive-metadata" | "encrypt-finish" | "prune";

export interface BackupRunStep {
	name: string;
	message: string;
	status: "running" | "succeeded" | "failed";
	startedAt: string;
	finishedAt?: string;
}

export interface BackupRun {
	id: string;
	kind: "backup" | "restore";
	startedAt: string;
	finishedAt: string | null;
	status: string;
	step: string;
	steps?: BackupRunStep[];
	error: string | null;
	log: string[];
	encrypted?: boolean;
	[key: string]: unknown;
}

export interface BackupStatus {
	updaterReachable: boolean;
	canRestore: boolean;
	passphraseSet: boolean;
	schedule: BackupSchedule;
	keep: number;
	lastScheduledAt: string | null;
	run: BackupRun | null;
	backups: BackupEntry[];
}

interface BackupState {
	lastScheduledAt: string | null;
	notifiedRun: string | null;
}

/** Dumps the database into `file`. Replaceable so tests do not need PostgreSQL. */
export type DatabaseDumper = (databaseUrl: string, file: string) => Promise<void>;

/** The signature a download link carries; it proves an administrator asked for this exact file in the last few minutes. */
export function signDownload(secret: string, name: string, expires: number): string {
	return createHmac("sha256", secret).update(`flixer-backup-download:${name}:${expires}`).digest("hex");
}

export function isBackupName(name: string): boolean {
	return BACKUP_NAME_PATTERN.test(name);
}

/** `flixer-20261024T224040Z.flxbak`, the updater's format; `taken` names get a counter before the Z. */
export function backupFileName(now: Date, taken: (name: string) => boolean): string {
	const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
	let name = `flixer-${stamp}.flxbak`;
	for (let i = 1; taken(name); i++) {
		name = `flixer-${stamp.slice(0, -1)}-${i}Z.flxbak`;
	}
	return name;
}

/** True when a scheduled backup is due: the schedule is on and the previous one is older than its period (less a little slack). */
export function isBackupDue(schedule: BackupSchedule, lastScheduledAt: string | null, now = Date.now()): boolean {
	if (schedule === "off") {
		return false;
	}
	const last = lastScheduledAt ? Date.parse(lastScheduledAt) : Number.NaN;
	return Number.isNaN(last) || now - last >= SCHEDULE_INTERVAL_MS[schedule] - SCHEDULE_SLACK_MS;
}

/** Runs pg_dump with the connection details in the environment, so the password never appears in a process listing. */
export const pgDump: DatabaseDumper = (databaseUrl, file) => {
	let parsed: URL;
	try {
		parsed = new URL(databaseUrl);
	} catch {
		return Promise.reject(new BadRequest("DATABASE_URL is not a valid URL."));
	}
	const env: NodeJS.ProcessEnv = {
		...process.env,
		PGHOST: parsed.hostname,
		PGPORT: parsed.port || "5432",
		PGUSER: decodeURIComponent(parsed.username),
		PGPASSWORD: decodeURIComponent(parsed.password),
		PGDATABASE: decodeURIComponent(parsed.pathname.replace(/^\//, "")),
	};
	const sslmode = parsed.searchParams.get("sslmode");
	if (sslmode) {
		env.PGSSLMODE = sslmode;
	}
	return new Promise((done, fail) => {
		const child = spawn("pg_dump", ["--format=custom", "--no-owner", "--file", file], { env, stdio: ["ignore", "ignore", "pipe"] });
		let stderr = "";
		child.stderr.on("data", (chunk: Buffer) => {
			if (stderr.length < 300) {
				stderr += chunk.toString();
			}
		});
		child.on("error", (error: NodeJS.ErrnoException) => fail(new Error(error.code === "ENOENT" ? "pg_dump is not installed." : `pg_dump: ${error.message}`)));
		child.on("close", (code) => (code === 0 ? done() : fail(new Error(`pg_dump failed (exit ${code}): ${stderr.trim().slice(0, 300)}`))));
	});
};

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * Creates, lists, downloads, uploads and deletes full-system `.flxbak` backups itself, writing the format the
 * flixer-updater restores. Only restore goes through the updater, because it must stop and start services.
 * The encryption passphrase lives in a 0600 file next to the backups (never in the database, which is inside the backup).
 */
@Injectable()
export class BackupService {

	private timer: ReturnType<typeof setInterval> | undefined;
	private lastRun: BackupRun | null = null;
	dumpDatabase: DatabaseDumper = pgDump;

	constructor(
		@Inject(DefaultDataSource) private readonly dataSource: DataSource,
		private readonly updater: UpdaterClient,
		private readonly notifications: NotificationService,
	) {}

	async $onInit(): Promise<void> {
		await this.sweepPartials();
	}

	$onReady(): void {
		this.timer = setInterval(() => void this.scheduledCheck(), CHECK_INTERVAL_MS);
		this.timer.unref?.();
		setTimeout(() => void this.scheduledCheck(), 2 * 60_000).unref?.();
	}

	$onDestroy(): void {
		clearInterval(this.timer);
	}

	async status(): Promise<BackupStatus> {
		const updaterRun = await this.updaterRun();
		const state = await this.readState();
		const run = updaterRun.run?.kind === "restore" ? updaterRun.run : this.lastRun ? structuredClone(this.lastRun) : null;
		return {
			updaterReachable: updaterRun.reachable,
			canRestore: updaterRun.reachable && this.updater.token() !== undefined,
			passphraseSet: (await this.readPassphrase()) !== undefined,
			schedule: await this.schedule(),
			keep: await this.keep(),
			lastScheduledAt: state.lastScheduledAt,
			run,
			backups: await this.list(),
		};
	}

	/** Starts a backup in the background and returns its run straight away; progress and errors are on the run. */
	async create(): Promise<BackupRun> {
		this.requireIdle();
		const previous = this.lastRun;
		const run = this.newRun();
		this.lastRun = run;
		try {
			const databaseUrl = this.databaseUrl();
			await this.requireNoRestore();
			void this.execute(run, databaseUrl).catch((error) => logger().error("The backup crashed.", error));
		} catch (error) {
			this.lastRun = previous;
			throw error;
		}
		return structuredClone(run);
	}

	async list(): Promise<BackupEntry[]> {
		const directory = this.backupDirectory();
		const names = (await readdir(directory).catch(() => [] as string[])).filter(isBackupName);
		const entries = await Promise.all(names.map((name) => this.entry(name).catch(() => null)));
		return entries.filter((entry): entry is BackupEntry => entry !== null).sort((a, b) => (a.createdAt === b.createdAt ? (a.name < b.name ? 1 : -1) : a.createdAt < b.createdAt ? 1 : -1));
	}

	async restore(name: string, passphrase: string | undefined): Promise<BackupRun> {
		this.requireName(name);
		const info = await stat(join(this.backupDirectory(), name)).catch(() => null);
		if (!info?.isFile()) {
			throw new NotFound("That backup no longer exists.");
		}
		if (this.lastRun?.status === "running") {
			throw new Conflict("A backup is running; wait for it to finish before restoring.");
		}
		const token = this.updater.token();
		if (!token) {
			throw new BadRequest("Restoring is not available yet: Flixer has no stream token secret to authenticate with the updater. Finish the setup wizard first.");
		}
		const response = await this.updater.call(`/v1/backups/${encodeURIComponent(name)}/restore`, {
			method: "POST",
			body: JSON.stringify({ databaseUrl: this.databaseUrl(), ...(passphrase ? { passphrase } : {}) }),
		});
		if (response.status !== 202) {
			const body = (await response.json().catch(() => ({}))) as { error?: string; code?: string };
			const message = body.error ?? `The updater answered ${response.status}.`;
			if (response.status === 409 || body.code === "busy") {
				throw new Conflict(message);
			}
			if (response.status === 404) {
				throw new NotFound(message);
			}
			throw new BadRequest(message);
		}
		return (await response.json()) as BackupRun;
	}

	async remove(name: string): Promise<void> {
		this.requireName(name);
		const { run } = await this.updaterRun();
		if (run?.kind === "restore" && run.status === "running") {
			throw new Conflict("A restore is running; backups cannot be deleted until it finishes.");
		}
		try {
			await unlink(join(this.backupDirectory(), name));
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") {
				throw new NotFound("That backup no longer exists.");
			}
			throw error;
		}
	}

	async setPassphrase(passphrase: unknown): Promise<void> {
		if (typeof passphrase !== "string" || passphrase.length < 8 || passphrase.length > 256) {
			throw new BadRequest("The passphrase must be between 8 and 256 characters.");
		}
		const file = this.passphraseFile();
		await mkdir(dirname(file), { recursive: true, mode: 0o700 });
		const temporary = join(dirname(file), `.passphrase-${randomBytes(6).toString("hex")}.pending`);
		try {
			await writeFile(temporary, passphrase, { mode: 0o600 });
			await chmod(temporary, 0o600);
			await rename(temporary, file);
		} catch (error) {
			await rm(temporary, { force: true });
			throw error;
		}
	}

	async clearPassphrase(): Promise<void> {
		await rm(this.passphraseFile(), { force: true });
	}

	/** Checks that an uploaded file is a Flixer backup, then moves it into the backups folder under a new name. */
	async upload(file: string): Promise<BackupEntry> {
		try {
			await readArchiveHeader(file);
		} catch {
			throw new BadRequest("That file is not a Flixer backup.");
		}
		const directory = this.backupDirectory();
		await mkdir(directory, { recursive: true, mode: 0o700 });
		const name = await this.freeName(directory);
		const target = join(directory, name);
		try {
			await rename(file, target);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EXDEV") {
				throw error;
			}
			const partial = join(directory, `.flixer-backup-${randomBytes(6).toString("hex")}.tmp`);
			try {
				await copyFile(file, partial);
				await rename(partial, target);
			} catch (copyError) {
				await rm(partial, { force: true });
				throw copyError;
			}
			await unlink(file).catch(() => undefined);
		}
		await chmod(target, 0o600);
		return this.entry(name);
	}

	downloadLink(name: string): { path: string; expiresAt: string } {
		this.requireName(name);
		const secret = appConfig().get("streamTokenSecret");
		if (!secret) {
			throw new BadRequest("Flixer has no stream token secret yet. Finish the setup wizard first.");
		}
		const expires = Date.now() + DOWNLOAD_LINK_TTL_MS;
		return { path: `/backups/download/${encodeURIComponent(name)}?expires=${expires}&signature=${signDownload(secret, name, expires)}`, expiresAt: new Date(expires).toISOString() };
	}

	/** Opens a backup for download after checking the signed link. */
	async openDownload(name: string, expires: string | undefined, signature: string | undefined): Promise<{ stream: ReadStream; size: number }> {
		const secret = appConfig().get("streamTokenSecret");
		const expiresAt = Number(expires);
		if (!secret || !isBackupName(name) || !Number.isFinite(expiresAt) || expiresAt < Date.now() || !signature) {
			throw new NotFound("This download link is invalid or has expired.");
		}
		const expected = Buffer.from(signDownload(secret, name, expiresAt));
		const supplied = Buffer.from(signature);
		if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
			throw new NotFound("This download link is invalid or has expired.");
		}
		const file = join(this.backupDirectory(), name);
		const info = await stat(file).catch(() => null);
		if (!info?.isFile()) {
			throw new NotFound("That backup no longer exists.");
		}
		return { stream: createReadStream(file), size: info.size };
	}

	/** Removes partial archives, dump and settings snapshots, and unfinished uploads left behind by a crash. */
	async sweepPartials(): Promise<void> {
		const directory = this.backupDirectory();
		for (const name of await readdir(directory).catch(() => [] as string[])) {
			if (PARTIAL_PATTERN.test(name) || /^\.passphrase-[0-9a-f]+\.pending$/.test(name)) {
				await rm(join(directory, name), { force: true });
			}
		}
		const uploads = join(directory, ".uploads");
		for (const name of await readdir(uploads).catch(() => [] as string[])) {
			await rm(join(uploads, name), { force: true, recursive: true });
		}
	}

	private newRun(): BackupRun {
		return { id: randomBytes(8).toString("hex"), kind: "backup", startedAt: new Date().toISOString(), finishedAt: null, status: "running", step: "", steps: [], error: null, log: [], encrypted: false };
	}

	private requireIdle(): void {
		if (this.lastRun?.status === "running") {
			throw new Conflict("A backup is already running.");
		}
	}

	private async requireNoRestore(): Promise<void> {
		const { run } = await this.updaterRun();
		if (run?.kind === "restore" && run.status === "running") {
			throw new Conflict("A restore is running; wait for it to finish before backing up.");
		}
	}

	/** The updater's current run, if it can be reached. Unreachable is a normal answer, not an error. */
	private async updaterRun(): Promise<{ reachable: boolean; run: BackupRun | null }> {
		if (!this.updater.token()) {
			return { reachable: false, run: null };
		}
		try {
			const response = await this.updater.call("/v1/status", { timeoutMs: UPDATER_STATUS_TIMEOUT_MS });
			if (!response.ok) {
				return { reachable: false, run: null };
			}
			const run = ((await response.json()) as { state?: { run?: BackupRun | null } }).state?.run ?? null;
			return { reachable: true, run };
		} catch {
			return { reachable: false, run: null };
		}
	}

	private startStep(run: BackupRun, name: BackupStepName, message: string): void {
		this.finishStep(run, "succeeded");
		run.step = name;
		run.steps!.push({ name, message, status: "running", startedAt: new Date().toISOString() });
		this.note(run, message);
	}

	private finishStep(run: BackupRun, status: "succeeded" | "failed"): void {
		const current = run.steps!.at(-1);
		if (current?.status === "running") {
			current.status = status;
			current.finishedAt = new Date().toISOString();
		}
	}

	private note(run: BackupRun, message: string): void {
		run.log.push(message);
		if (run.log.length > MAX_LOG_LINES) {
			run.log.splice(0, run.log.length - MAX_LOG_LINES);
		}
	}

	private async execute(run: BackupRun, databaseUrl: string): Promise<void> {
		const directory = this.backupDirectory();
		const token = randomBytes(6).toString("hex");
		const dumpFile = join(directory, `.dump-${token}.tmp`);
		const snapshotFile = join(directory, `.config-${token}.tmp`);
		const partial = join(directory, `.flixer-backup-${token}.tmp`);
		try {
			await mkdir(directory, { recursive: true, mode: 0o700 });
			const passphrase = await this.readPassphrase();
			run.encrypted = passphrase !== undefined;
			const keep = await this.keep();

			this.startStep(run, "dump-database", "Dumping the database");
			await this.dumpDatabase(databaseUrl, dumpFile);
			const sources = await this.sources(dumpFile, snapshotFile, (message) => this.note(run, message));

			await writeArchive({
				destination: partial,
				sources,
				versions: { flixer: flixerVersion },
				passphrase,
				warn: (message) => {
					this.note(run, message);
					logger().warn(message);
				},
				onStep: (step) => {
					const messages = { "archive-config": "Archiving settings", "archive-secrets": "Archiving shared secrets", "archive-metadata": "Archiving metadata", "encrypt-finish": passphrase ? "Encrypting and finishing the archive" : "Finishing the archive" };
					this.startStep(run, step, messages[step]);
				},
			});
			await chmod(partial, 0o600);
			const name = await this.freeName(directory);
			await rename(partial, join(directory, name));

			this.startStep(run, "prune", `Keeping the newest ${keep} backups`);
			await this.prune(keep);
			this.finishStep(run, "succeeded");
			run.status = "succeeded";
			this.note(run, `Created ${name}.`);
		} catch (error) {
			this.finishStep(run, "failed");
			run.status = "failed";
			run.error = errorMessage(error);
			this.note(run, `Backup failed: ${run.error}`);
			logger().warn(`Backup failed: ${run.error}`);
		} finally {
			run.finishedAt = new Date().toISOString();
			await Promise.all([dumpFile, snapshotFile, partial].map((file) => rm(file, { force: true })));
		}
	}

	private async sources(dumpFile: string, snapshotFile: string, note: (message: string) => void): Promise<ArchiveSources> {
		const sources: ArchiveSources = { database: dumpFile };
		const configDir = configDirectory();
		const liveDatabase = /^flixer-config\.db(-wal|-shm|-journal)?$/;
		const store = appConfig().persistent;
		if (store) {
			store.snapshot(snapshotFile);
		}
		if (await isDirectory(configDir)) {
			sources.config = { dir: configDir, exclude: (relative) => liveDatabase.test(relative), extra: store ? [{ name: "flixer-config.db", file: snapshotFile }] : [] };
		} else {
			note("The settings folder was not found; settings are not in this backup.");
		}
		const secretsFile = process.env.STREAM_TOKEN_SECRET_FILE?.trim();
		const secretsDir = secretsFile ? dirname(resolve(secretsFile)) : undefined;
		if (secretsDir && (await isDirectory(secretsDir))) {
			sources.secrets = { dir: secretsDir };
		} else {
			note("The shared secrets folder was not found; secrets are not in this backup.");
		}
		const metadataDir = resolve(process.env.METADATA_DIR?.trim() || "./data/metadata");
		if (await isDirectory(metadataDir)) {
			sources.metadata = { dir: metadataDir };
		} else {
			note("The metadata folder was not found; metadata is not in this backup.");
		}
		return sources;
	}

	/** Deletes the oldest archives beyond `keep`. Only `.flxbak` files are touched. */
	async prune(keep: number): Promise<void> {
		const directory = this.backupDirectory();
		const archives = await Promise.all(
			(await readdir(directory).catch(() => [] as string[])).filter(isBackupName).map(async (name) => ({ name, modified: (await stat(join(directory, name)).catch(() => null))?.mtimeMs ?? 0 })),
		);
		archives.sort((a, b) => b.modified - a.modified || (a.name < b.name ? 1 : -1));
		for (const old of archives.slice(Math.max(keep, 1))) {
			await rm(join(directory, old.name), { force: true });
		}
	}

	private async entry(name: string): Promise<BackupEntry> {
		const file = join(this.backupDirectory(), name);
		const [{ header }, info] = await Promise.all([readArchiveHeader(file), stat(file)]);
		return toEntry(name, info.size, header);
	}

	private async freeName(directory: string): Promise<string> {
		const existing = new Set(await readdir(directory).catch(() => [] as string[]));
		return backupFileName(new Date(), (name) => existing.has(name));
	}

	private requireName(name: string): void {
		if (!isBackupName(name)) {
			throw new BadRequest("That is not a valid backup name.");
		}
	}

	private databaseUrl(): string {
		const url = appConfig().get("databaseUrl");
		if (!url) {
			throw new BadRequest("DATABASE_URL is not configured, so the database cannot be backed up.");
		}
		return url;
	}

	private backupDirectory(): string {
		return resolve(process.env.BACKUP_DIR?.trim() || "./data/backups");
	}

	private passphraseFile(): string {
		return process.env.BACKUP_PASSPHRASE_FILE?.trim() || join(this.backupDirectory(), ".passphrase");
	}

	private async readPassphrase(): Promise<string | undefined> {
		const value = await readFile(this.passphraseFile(), "utf8").catch(() => "");
		return value === "" ? undefined : value;
	}

	private async scheduledCheck(): Promise<void> {
		try {
			const schedule = await this.schedule();
			const state = await this.readState();
			const run = this.lastRun;
			if (run?.status === "failed" && state.notifiedRun !== run.id) {
				await this.writeState({ ...state, notifiedRun: run.id });
				await this.notifyFailure(run.error);
			}
			if (run?.status === "running" || !isBackupDue(schedule, state.lastScheduledAt)) {
				return;
			}
			await this.create();
			await this.writeState({ ...(await this.readState()), lastScheduledAt: new Date().toISOString() });
			logger().info(`Started the ${schedule} scheduled backup.`);
		} catch (error) {
			logger().warn("The scheduled backup could not be started.", error);
		}
	}

	private async notifyFailure(reason: string | null): Promise<void> {
		const admins = await this.dataSource.getRepository(User).find({ where: { role: "admin", disabledAt: IsNull() }, select: { id: true } });
		if (admins.length === 0) {
			return;
		}
		await this.notifications
			.send({ kind: "admin", title: "Flixer backup failed", body: reason ?? "The last backup did not finish.", url: "/admin?tab=backups" }, admins.map((admin) => admin.id))
			.catch((error) => logger().warn("Could not notify admins about a failed backup.", error));
	}

	private async settingValue(key: string): Promise<unknown> {
		return (await this.dataSource.getRepository(Setting).findOneBy({ key }))?.value;
	}

	private async schedule(): Promise<BackupSchedule> {
		const value = await this.settingValue("backups_schedule");
		return value === "daily" || value === "weekly" ? value : "off";
	}

	private async keep(): Promise<number> {
		const value = await this.settingValue("backups_keep");
		return typeof value === "number" && Number.isInteger(value) && value >= 1 ? value : DEFAULT_KEEP;
	}

	private async readState(): Promise<BackupState> {
		const value = (await this.settingValue("backups_state")) as Partial<BackupState> | null;
		return { lastScheduledAt: value?.lastScheduledAt ?? null, notifiedRun: value?.notifiedRun ?? null };
	}

	private async writeState(state: BackupState): Promise<void> {
		await this.dataSource.getRepository(Setting).update({ key: "backups_state" }, { value: state as never });
	}
}

function toEntry(name: string, size: number, header: BackupHeader): BackupEntry {
	return { name, size, createdAt: header.createdAt, encrypted: header.encrypted, components: header.components, versions: header.versions };
}

async function isDirectory(path: string): Promise<boolean> {
	return (await stat(path).catch(() => null))?.isDirectory() === true;
}
