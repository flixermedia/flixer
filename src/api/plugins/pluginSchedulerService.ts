import { Inject, Injectable, logger } from "@tsed/di";
import { DataSource } from "typeorm";
import { DefaultDataSource } from "../../datasources/defaultDataSource.datasource.js";
import { PluginInstallation } from "../../entities/pluginInstallation.entity.js";
import { PluginWasiRuntime } from "./pluginWasiRuntime.js";

const TICK_MS = 30_000;
const SYSTEM_USER = { id: "system", role: "system" } as const;

/** Runs the operations plugins declare under `schedules`, in this process only (not coordinated across instances). */
@Injectable()
export class PluginSchedulerService {
	private timer: NodeJS.Timeout | undefined;
	private readonly lastRun = new Map<string, number>();
	private readonly running = new Set<string>();

	constructor(
		@Inject(DefaultDataSource) private readonly dataSource: DataSource,
		private readonly runtime: PluginWasiRuntime,
	) {}

	$onInit(): void {
		this.timer = setInterval(() => void this.tick(), TICK_MS);
		this.timer.unref();
	}

	$onDestroy(): void {
		if (this.timer) clearInterval(this.timer);
		this.timer = undefined;
	}

	async tick(now = Date.now()): Promise<void> {
		const installations = await this.dataSource.getRepository(PluginInstallation).find({ where: { enabled: true } });
		await Promise.all(installations.map((installation) => this.runDue(installation, now)));
	}

	private async runDue(installation: PluginInstallation, now: number): Promise<void> {
		const { manifest, approvedPermissions, pluginId } = installation;
		if (!manifest.targets.flixer || !manifest.capabilities.includes("schedule")) return;
		if (!approvedPermissions.includes("schedule.run") || !manifest.permissions.includes("schedule.run")) return;
		for (const schedule of manifest.schedules ?? []) {
			const key = `${pluginId}:${schedule.operation}`;
			if (this.running.has(key)) continue;
			const last = this.lastRun.get(key);
			if (last === undefined) {
				// First sighting after boot: wait a full interval rather than all firing at startup.
				this.lastRun.set(key, now);
				continue;
			}
			if (now - last < schedule.intervalSeconds * 1000) continue;
			this.lastRun.set(key, now);
			this.running.add(key);
			try {
				await this.runtime.execute(installation, schedule.operation, SYSTEM_USER, {});
			} catch (error: unknown) {
				logger().warn(`Scheduled plugin operation ${key} failed.`, error);
			} finally {
				this.running.delete(key);
			}
		}
	}
}
