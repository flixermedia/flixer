import { Inject, Injectable, logger } from "@tsed/di";
import { BadRequest, Conflict } from "@tsed/exceptions";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readdir, rm, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { DataSource, IsNull } from "typeorm";
import { version as flixerVersion } from "../../config/config.js";
import { appConfig } from "../../config/store/appConfig.js";
import { DefaultDataSource } from "../../datasources/defaultDataSource.datasource.js";
import { Setting } from "../../entities/setting.entity.js";
import { User } from "../../entities/user.entity.js";
import { NotificationService } from "../notifications/notificationService.js";

export const UPDATE_SETTING_KEYS = ["updates_check_enabled", "updates_auto_update", "updates_watchtower_url"];

const COMPONENTS = [
	{ id: "flixer", label: "API", repo: "flixermedia/flixer" },
	{ id: "web", label: "Web", repo: "flixermedia/flixer-web" },
	{ id: "streamer", label: "Streamer", repo: "flixermedia/flixer-streamer" },
	{ id: "indexer", label: "Indexer", repo: "flixermedia/flixer-indexer" },
] as const;
export type ComponentId = (typeof COMPONENTS)[number]["id"];

const CHECK_INTERVAL_MS = 6 * 60 * 60_000;
const LATEST_CACHE_MS = 10 * 60_000;
/** An update that has not finished by then is reported as failed. */
const RUN_TIMEOUT_MS = 15 * 60_000;
const BACKUPS_KEPT = 5;
const DEFAULT_WATCHTOWER_URL = "http://watchtower:8080";
const BACKUP_PATTERN = /^flixer-.*\.dump$/;

export interface ComponentStatus {
	id: ComponentId;
	label: string;
	installed: string | null;
	latest: string | null;
	reachable: boolean;
	updateAvailable: boolean;
}

export interface UpdateRun {
	id: string;
	startedAt: string;
	finishedAt: string | null;
	status: "running" | "succeeded" | "failed";
	targets: Partial<Record<ComponentId, string>>;
	backup: string | null;
	error: string | null;
}

interface UpdateState {
	lastCheckedAt: string | null;
	notified: string | null;
	run: UpdateRun | null;
}

export interface UpdateStatus {
	components: ComponentStatus[];
	updatesAvailable: number;
	lastCheckedAt: string | null;
	canApply: boolean;
	run: UpdateRun | null;
	backups: Array<{ name: string; sizeBytes: number; createdAt: string }>;
}

export function parseVersion(value: string | null | undefined): number[] | null {
	const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec((value ?? "").trim());
	return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

/** True when `latest` is a newer release than `installed`; development builds never count as outdated. */
export function isNewer(latest: string | null | undefined, installed: string | null | undefined): boolean {
	const a = parseVersion(latest);
	const b = parseVersion(installed);
	if (!a || !b) {
		return false;
	}
	for (let i = 0; i < 3; i += 1) {
		if (a[i] !== b[i]) {
			return a[i] > b[i];
		}
	}
	return false;
}

/**
 * Knows which version of every Flixer component is running and which is the newest release, and applies updates by asking
 * Watchtower (which holds the Docker socket) to pull the newest images and recreate the containers. Flixer itself never
 * touches Docker.
 */
@Injectable()
export class UpdateService {

	private latestCache: { at: number; versions: Partial<Record<ComponentId, string>> } | null = null;
	private timer: ReturnType<typeof setInterval> | undefined;

	constructor(
		@Inject(DefaultDataSource) private readonly dataSource: DataSource,
		private readonly notifications: NotificationService,
	) {}

	$onReady(): void {
		this.timer = setInterval(() => void this.scheduledCheck(), CHECK_INTERVAL_MS);
		this.timer.unref?.();
		setTimeout(() => void this.scheduledCheck(), 60_000).unref?.();
	}

	$onDestroy(): void {
		clearInterval(this.timer);
	}

	async status(forceCheck = false): Promise<UpdateStatus> {
		const [installed, latest] = await Promise.all([this.installedVersions(), this.latestVersions(forceCheck)]);
		const components = COMPONENTS.map((component): ComponentStatus => {
			const current = installed[component.id];
			const newest = latest[component.id] ?? null;
			return {
				id: component.id,
				label: component.label,
				installed: current ?? null,
				latest: newest,
				reachable: current !== undefined,
				updateAvailable: isNewer(newest, current),
			};
		});
		const state = await this.settleRun(await this.readState(), components);
		return {
			components,
			updatesAvailable: components.filter((component) => component.updateAvailable).length,
			lastCheckedAt: state.lastCheckedAt,
			canApply: this.watchtowerToken() !== undefined,
			run: state.run,
			backups: await this.listBackups(),
		};
	}

	/** Backs up the database, then asks Watchtower to update every labelled container. Returns once the run is recorded. */
	async apply(): Promise<UpdateRun> {
		const token = this.watchtowerToken();
		if (!token) {
			throw new BadRequest("Updates are not configured. Run Flixer with the Watchtower service from docker-compose.yml and set WATCHTOWER_TOKEN.");
		}
		const status = await this.status(true);
		if (status.run?.status === "running") {
			throw new Conflict("An update is already in progress.");
		}
		const outdated = status.components.filter((component) => component.updateAvailable);
		if (outdated.length === 0) {
			throw new BadRequest("Everything is already up to date.");
		}

		const backup = await this.backupDatabase();
		const run: UpdateRun = {
			id: randomUUID(),
			startedAt: new Date().toISOString(),
			finishedAt: null,
			status: "running",
			targets: Object.fromEntries(outdated.map((component) => [component.id, component.latest as string])),
			backup,
			error: null,
		};
		await this.writeState({ ...(await this.readState()), run });
		logger().info(`Starting update ${run.id}: ${outdated.map((component) => `${component.id} ${component.installed} -> ${component.latest}`).join(", ")}.`);
		void this.triggerWatchtower(token, run.id);
		return run;
	}

	/** Watchtower answers only after it has recreated every container, including this one, so the reply may never arrive. */
	private async triggerWatchtower(token: string, runId: string): Promise<void> {
		try {
			const response = await fetch(`${await this.watchtowerUrl()}/v1/update`, {
				method: "POST",
				headers: { authorization: `Bearer ${token}` },
				signal: AbortSignal.timeout(RUN_TIMEOUT_MS),
			});
			if (!response.ok) {
				await this.failRun(runId, `Watchtower answered ${response.status}.`);
			}
		} catch (error) {
			await this.failRun(runId, `Could not reach Watchtower: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	private async failRun(runId: string, message: string): Promise<void> {
		const state = await this.readState();
		if (state.run?.id === runId && state.run.status === "running") {
			logger().error(`Update ${runId} failed: ${message}`);
			await this.writeState({ ...state, run: { ...state.run, status: "failed", finishedAt: new Date().toISOString(), error: message } });
		}
	}

	/** A run is finished when every component is reachable on its target version; it fails if that takes too long. */
	private async settleRun(state: UpdateState, components: ComponentStatus[]): Promise<UpdateState> {
		const run = state.run;
		if (!run || run.status !== "running") {
			return state;
		}
		const pending = components.filter((component) => !component.reachable || isNewer(run.targets[component.id], component.installed));
		const timedOut = Date.now() - new Date(run.startedAt).getTime() > RUN_TIMEOUT_MS;
		if (pending.length > 0 && !timedOut) {
			return state;
		}
		const finishedAt = new Date().toISOString();
		const settled: UpdateRun =
			pending.length === 0
				? { ...run, status: "succeeded", finishedAt }
				: { ...run, status: "failed", finishedAt, error: `${pending.map((component) => component.label).join(", ")} did not come back on the new version. Check the container logs; the database backup from before the update is kept.` };
		const next = { ...state, run: settled };
		await this.writeState(next);
		return next;
	}

	private async scheduledCheck(): Promise<void> {
		try {
			if ((await this.settingValue("updates_check_enabled")) === false) {
				return;
			}
			const status = await this.status(true);
			const outdated = status.components.filter((component) => component.updateAvailable);
			if (outdated.length === 0) {
				return;
			}
			const signature = outdated.map((component) => `${component.id}@${component.latest}`).join(",");
			const state = await this.readState();
			if (state.notified !== signature) {
				await this.writeState({ ...state, notified: signature });
				await this.notifyAdmins(outdated);
			}
			if ((await this.settingValue("updates_auto_update")) === true && status.canApply && status.run?.status !== "running") {
				await this.apply();
			}
		} catch (error) {
			logger().warn("The scheduled update check failed.", error);
		}
	}

	private async notifyAdmins(outdated: ComponentStatus[]): Promise<void> {
		const admins = await this.dataSource.getRepository(User).find({ where: { role: "admin", disabledAt: IsNull() }, select: { id: true } });
		if (admins.length === 0) {
			return;
		}
		const list = outdated.map((component) => `${component.label} ${component.latest}`).join(", ");
		await this.notifications
			.send({ kind: "admin", title: "Flixer update available", body: list, url: "/admin?tab=updates" }, admins.map((admin) => admin.id))
			.catch((error) => logger().warn("Could not notify admins about an update.", error));
	}

	private async installedVersions(): Promise<Partial<Record<ComponentId, string>>> {
		const config = appConfig();
		const webUrl = (process.env.WEB_INTERNAL_URL?.trim() || "http://web").replace(/\/+$/, "");
		const read = async (url: string): Promise<string | undefined> => {
			try {
				const response = await fetch(url, { signal: AbortSignal.timeout(3_000) });
				const body = (await response.json()) as { version?: unknown };
				return response.ok && typeof body.version === "string" ? body.version : undefined;
			} catch {
				return undefined;
			}
		};
		const [web, streamer, indexer] = await Promise.all([
			read(`${webUrl}/version.json`),
			read(`${config.get("streamerInternalUrl")}/healthz`),
			read(`${config.get("indexerUrl")}/health`),
		]);
		return { flixer: flixerVersion, ...(web ? { web } : {}), ...(streamer ? { streamer } : {}), ...(indexer ? { indexer } : {}) };
	}

	private async latestVersions(force: boolean): Promise<Partial<Record<ComponentId, string>>> {
		if (!force && this.latestCache && Date.now() - this.latestCache.at < LATEST_CACHE_MS) {
			return this.latestCache.versions;
		}
		const versions: Partial<Record<ComponentId, string>> = {};
		await Promise.all(
			COMPONENTS.map(async (component) => {
				try {
					const response = await fetch(`https://api.github.com/repos/${component.repo}/releases/latest`, {
						headers: { accept: "application/vnd.github+json", "user-agent": `flixer/${flixerVersion}` },
						signal: AbortSignal.timeout(8_000),
					});
					const parsed = parseVersion(((await response.json()) as { tag_name?: string }).tag_name);
					if (response.ok && parsed) {
						versions[component.id] = parsed.join(".");
					}
				} catch {
					// An unreachable GitHub just means no update information for this component.
				}
			}),
		);
		if (Object.keys(versions).length === 0 && this.latestCache) {
			return this.latestCache.versions;
		}
		this.latestCache = { at: Date.now(), versions };
		await this.writeState({ ...(await this.readState()), lastCheckedAt: new Date().toISOString() });
		return versions;
	}

	private watchtowerToken(): string | undefined {
		return process.env.WATCHTOWER_TOKEN?.trim() || undefined;
	}

	private async watchtowerUrl(): Promise<string> {
		const configured = await this.settingValue("updates_watchtower_url");
		const url = (typeof configured === "string" && configured.trim() !== "" ? configured.trim() : process.env.WATCHTOWER_URL?.trim()) || DEFAULT_WATCHTOWER_URL;
		return url.replace(/\/+$/, "");
	}

	private backupDirectory(): string {
		return resolve(process.env.BACKUP_DIR?.trim() || "./data/backups");
	}

	/** Writes a pg_dump of the database and keeps only the newest few. Aborts the update when it cannot. */
	private async backupDatabase(): Promise<string> {
		const databaseUrl = appConfig().get("databaseUrl");
		if (!databaseUrl) {
			throw new BadRequest("DATABASE_URL is not configured, so the database cannot be backed up.");
		}
		const url = new URL(databaseUrl);
		const directory = this.backupDirectory();
		await mkdir(directory, { recursive: true });
		const name = `flixer-${new Date().toISOString().replace(/[:.]/g, "-")}.dump`;
		const file = join(directory, name);
		const env = {
			...process.env,
			PGHOST: url.hostname,
			PGPORT: url.port || "5432",
			PGUSER: decodeURIComponent(url.username),
			PGPASSWORD: decodeURIComponent(url.password),
			PGDATABASE: decodeURIComponent(url.pathname.replace(/^\//, "")),
		};
		try {
			await new Promise<void>((done, fail) => {
				const child = spawn("pg_dump", ["--format=custom", "--no-owner", "--file", file], { env });
				let stderr = "";
				child.stderr.on("data", (chunk) => (stderr += chunk));
				child.on("error", (error) => fail(new Error(`pg_dump could not start (${error.message})`)));
				child.on("close", (code) => (code === 0 ? done() : fail(new Error(stderr.trim().slice(0, 300) || `pg_dump exited with ${code}`))));
			});
		} catch (error) {
			await rm(file, { force: true });
			throw new BadRequest(`The database backup failed: ${(error as Error).message}. The update was not started.`);
		}
		const backups = (await readdir(directory)).filter((entry) => BACKUP_PATTERN.test(entry)).sort();
		await Promise.all(backups.slice(0, Math.max(0, backups.length - BACKUPS_KEPT)).map((entry) => rm(join(directory, entry), { force: true })));
		return name;
	}

	private async listBackups(): Promise<UpdateStatus["backups"]> {
		try {
			const directory = this.backupDirectory();
			const names = (await readdir(directory)).filter((entry) => BACKUP_PATTERN.test(entry)).sort().reverse();
			return await Promise.all(
				names.map(async (name) => {
					const info = await stat(join(directory, name));
					return { name, sizeBytes: info.size, createdAt: info.mtime.toISOString() };
				}),
			);
		} catch {
			return [];
		}
	}

	private async settingValue(key: string): Promise<unknown> {
		return (await this.dataSource.getRepository(Setting).findOneBy({ key }))?.value;
	}

	private async readState(): Promise<UpdateState> {
		const value = (await this.settingValue("updates_state")) as Partial<UpdateState> | null;
		return { lastCheckedAt: value?.lastCheckedAt ?? null, notified: value?.notified ?? null, run: value?.run ?? null };
	}

	private async writeState(state: UpdateState): Promise<void> {
		await this.dataSource.getRepository(Setting).update({ key: "updates_state" }, { value: state as never });
	}
}
