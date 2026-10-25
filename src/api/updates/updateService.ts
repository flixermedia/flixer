import { Inject, Injectable, logger } from "@tsed/di";
import { BadRequest, Conflict } from "@tsed/exceptions";
import { readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { DataSource, IsNull } from "typeorm";
import { version as flixerVersion } from "../../config/config.js";
import { appConfig } from "../../config/store/appConfig.js";
import { DefaultDataSource } from "../../datasources/defaultDataSource.datasource.js";
import { Setting } from "../../entities/setting.entity.js";
import { User } from "../../entities/user.entity.js";
import { NotificationService } from "../notifications/notificationService.js";
import { UpdaterClient } from "./updaterClient.js";

export { deriveUpdaterToken } from "./updaterClient.js";

export const UPDATE_SETTING_KEYS = ["updates_check_enabled", "updates_auto_update", "updates_updater_url"];

const COMPONENTS = [
	{ id: "flixer", label: "API", repo: "flixermedia/flixer" },
	{ id: "web", label: "Web", repo: "flixermedia/flixer-web" },
	{ id: "streamer", label: "Streamer", repo: "flixermedia/flixer-streamer" },
	{ id: "indexer", label: "Indexer", repo: "flixermedia/flixer-indexer" },
] as const;
export type ComponentId = (typeof COMPONENTS)[number]["id"];

const CHECK_INTERVAL_MS = 6 * 60 * 60_000;
const LATEST_CACHE_MS = 10 * 60_000;
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
	status: "running" | "succeeded" | "failed" | "rolled_back" | "rollback_failed";
	step: string;
	targets: Partial<Record<ComponentId, string>>;
	previous: Partial<Record<ComponentId, string>>;
	backup: string | null;
	error: string | null;
	log: string[];
}

interface UpdateState {
	lastCheckedAt: string | null;
	notified: string | null;
}

export interface UpdateStatus {
	components: ComponentStatus[];
	updatesAvailable: number;
	lastCheckedAt: string | null;
	canApply: boolean;
	updaterReachable: boolean;
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
 * the flixer-updater sidecar (which holds the Docker socket) to back up, pin, recreate and, if needed, roll back. Flixer
 * itself never touches Docker.
 */
@Injectable()
export class UpdateService {

	private latestCache: { at: number; versions: Partial<Record<ComponentId, string>> } | null = null;
	private timer: ReturnType<typeof setInterval> | undefined;

	constructor(
		@Inject(DefaultDataSource) private readonly dataSource: DataSource,
		private readonly notifications: NotificationService,
		private readonly updater: UpdaterClient,
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
		const state = await this.readState();
		const updaterState = await this.updaterStatus();
		return {
			components,
			updatesAvailable: components.filter((component) => component.updateAvailable).length,
			lastCheckedAt: state.lastCheckedAt,
			canApply: this.updater.token() !== undefined,
			updaterReachable: updaterState !== null,
			run: updaterState?.run ?? null,
			backups: await this.listBackups(),
		};
	}

	/** Asks the updater to move every outdated component to its newest release. It backs up, updates and rolls back. */
	async apply(): Promise<UpdateRun> {
		if (!this.updater.token()) {
			throw new BadRequest("Updates are not available yet: Flixer has no app secret to authenticate with the updater. Finish the setup wizard first.");
		}
		const status = await this.status(true);
		if (!status.updaterReachable) {
			throw new BadRequest("The updater is not reachable. Check that the flixer-updater container is running.");
		}
		if (status.run?.status === "running") {
			throw new Conflict("An update is already in progress.");
		}
		const outdated = status.components.filter((component) => component.updateAvailable);
		if (outdated.length === 0) {
			throw new BadRequest("Everything is already up to date.");
		}
		const targets = Object.fromEntries(outdated.map((component) => [component.id, component.latest as string]));
		const current = Object.fromEntries(status.components.filter((component) => component.installed).map((component) => [component.id, component.installed as string]));
		logger().info(`Starting update: ${outdated.map((component) => `${component.id} ${component.installed} -> ${component.latest}`).join(", ")}.`);
		const databaseUrl = appConfig().get("databaseUrl");
		if (!databaseUrl) {
			throw new BadRequest("DATABASE_URL is not configured, so the database cannot be backed up.");
		}
		const response = await this.updater.call("/v1/update", { method: "POST", body: JSON.stringify({ targets, current, databaseUrl }) });
		const body = (await response.json().catch(() => ({}))) as UpdateRun & { error?: string };
		if (response.status === 409) {
			throw new Conflict("An update is already in progress.");
		}
		if (!response.ok) {
			throw new BadRequest(body.error ?? `The updater answered ${response.status}.`);
		}
		return body;
	}

	/** The latest run as the updater reports it, or null when the updater is not configured or not reachable. */
	private async updaterStatus(): Promise<{ run: UpdateRun | null } | null> {
		if (!this.updater.token()) {
			return null;
		}
		try {
			const response = await this.updater.call("/v1/status");
			if (!response.ok) {
				return null;
			}
			const body = (await response.json()) as { state?: { run?: (UpdateRun & { kind?: string }) | null } };
			const run = body.state?.run ?? null;
			return { run: run && (run.kind === undefined || run.kind === "update") ? run : null };
		} catch {
			return null;
		}
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
			if ((await this.settingValue("updates_auto_update")) === true && status.canApply && status.updaterReachable && status.run?.status !== "running") {
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

	private backupDirectory(): string {
		return resolve(process.env.BACKUP_DIR?.trim() || "./data/backups");
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
		return { lastCheckedAt: value?.lastCheckedAt ?? null, notified: value?.notified ?? null };
	}

	private async writeState(state: UpdateState): Promise<void> {
		await this.dataSource.getRepository(Setting).update({ key: "updates_state" }, { value: state as never });
	}
}
