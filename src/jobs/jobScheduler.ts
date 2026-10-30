import { Inject, Injectable, logger } from "@tsed/di";
import { tryCatch } from "@dschz/try-catch";
import { BadRequest } from "@tsed/exceptions";
import { createHmac } from "node:crypto";
import { readdir, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import { PgBoss, type Job, type JobWithMetadata, type QueueResult, type Schedule } from "pg-boss";
import { DataSource } from "typeorm";
import { DefaultDataSource } from "../datasources/defaultDataSource.datasource.js";
import { Setting } from "../entities/setting.entity.js";
import { SentryService } from "../sentry/sentryService.js";
import { appConfig } from "../config/store/appConfig.js";
import { logDirectory } from "../config/dataPath.js";
import { MediaLibrariesService } from "../api/mediaLibraries/mediaLibrariesService.js";
import { IndexerClient } from "../api/indexer/indexerClient.js";
import {
	ADMIN_SCHEDULED_TASKS,
	ADMIN_SCHEDULED_TASKS_SETTING,
	defaultAdminScheduledTaskConfigs,
	isAdminScheduledTaskId,
	type AdminScheduledTaskConfig,
	type AdminScheduledTaskConfigs,
	type AdminScheduledTaskId,
} from "./adminScheduledTasks.js";
import { cleanupExpiredUserSessions, SESSION_CLEANUP_JOB } from "./sessionCleanupJob.js";

const SESSION_CLEANUP_CRON = "0 * * * *";
const PG_BOSS_CONNECTION_POOL_SIZE = 2;
const SCHEDULER_SHUTDOWN_TIMEOUT_MS = 30_000;
const SUPPORTED_JOB_QUEUES = new Set([SESSION_CLEANUP_JOB, ...ADMIN_SCHEDULED_TASKS.map(({ queue }) => queue)]);
const JOB_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LOG_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export interface AdminTaskRunStatus {
	id: AdminScheduledTaskId;
	name: string;
	category: string;
	description: string;
	enabled: boolean;
	cron: string;
	state: "running" | "queued" | "completed" | "failed" | "cancelled" | "never";
	lastRunAt: string | null;
	lastError?: string;
	progress?: number;
}

interface IndexerScanState {
	libraryId: string;
	state: string;
	discovered: number;
	done: number;
	failed: number;
	startedAt?: string;
	error?: string;
}

@Injectable()
export class JobScheduler {
	private boss?: PgBoss;
	private readonly activeTaskControllers = new Map<string, AbortController>();
	private readonly activeTaskProgress = new Map<string, number>();

	constructor(
		@Inject(DefaultDataSource) private readonly dataSource: DataSource,
		private readonly sentryService: SentryService,
		private readonly libraries: MediaLibrariesService,
		private readonly indexer: IndexerClient,
	) {}

	async $onInit(): Promise<void> {
		const connectionString = appConfig().get("databaseUrl");
		if (!connectionString) {
			throw new Error("DATABASE_URL must be set to initialize the job scheduler.");
		}

		const boss = new PgBoss({
			connectionString,
			max: PG_BOSS_CONNECTION_POOL_SIZE,
		});
		boss.on("error", (error) => {
			logger().error("pg-boss reported a scheduler error.", error);
			this.sentryService.captureException(error);
		});

		await boss.start();
		const [setupError] = await tryCatch(async () => {
			await boss.createQueue(SESSION_CLEANUP_JOB);
			await boss.work(SESSION_CLEANUP_JOB, async () => {
				const [jobError] = await tryCatch(() => cleanupExpiredUserSessions(this.dataSource));
				if (jobError) {
					logger().error(`Job ${SESSION_CLEANUP_JOB} failed.`, jobError);
					this.sentryService.captureException(jobError);
					throw jobError;
				}
			});
			await boss.schedule(SESSION_CLEANUP_JOB, SESSION_CLEANUP_CRON);
			for (const task of ADMIN_SCHEDULED_TASKS) {
				await boss.createQueue(task.queue, { expireInSeconds: 24 * 60 * 60, retryLimit: 2 });
				await boss.work(
					task.queue,
					{ localConcurrency: 1, groupConcurrency: 1 },
					(jobs: Job<{ taskId?: string }>[]) => this.processAdminTask(task.id, jobs),
				);
			}
			const configs = await this.getAdminTaskConfigs(true);
			for (const task of ADMIN_SCHEDULED_TASKS) {
				const schedule = configs[task.id];
				if (schedule.enabled) {
					await boss.schedule(
						task.queue,
						schedule.cron,
						{ taskId: task.id },
						{ tz: "UTC", group: { id: task.id } },
					);
				} else {
					await boss.unschedule(task.queue);
				}
			}
		});
		if (setupError) {
			const [stopError] = await tryCatch(() =>
				boss.stop({ graceful: true, timeout: SCHEDULER_SHUTDOWN_TIMEOUT_MS }),
			);
			if (stopError) {
				logger().error("Failed to stop pg-boss after scheduler initialization failed.", stopError);
			}
			throw setupError;
		}

		this.boss = boss;
		logger().info("Started the PostgreSQL-backed job scheduler.");
	}

	async $onDestroy(): Promise<void> {
		if (this.boss) {
			await this.boss.stop({ graceful: true, timeout: SCHEDULER_SHUTDOWN_TIMEOUT_MS });
			this.boss = undefined;
		}
	}

	async getQueues(): Promise<QueueResult[]> {
		return this.getBoss().getQueues();
	}

	async findJobs(queueName: string, limit = 100): Promise<JobWithMetadata[]> {
		const boss = this.getBossForQueue(queueName);
		if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
			throw new BadRequest("Job limit must be an integer between 1 and 1000.");
		}

		return boss.findJobs<object>(queueName, { limit });
	}

	async getJob(queueName: string, jobId: string): Promise<JobWithMetadata | null> {
		const boss = this.getBossForQueue(queueName);
		this.assertJobId(jobId);
		const [job] = await boss.findJobs<object>(queueName, { id: jobId, limit: 1 });
		return job ?? null;
	}

	async enqueue(queueName: string, data?: Record<string, unknown>): Promise<string | null> {
		return this.getBossForQueue(queueName).send(queueName, data ?? {});
	}

	async retryJob(queueName: string, jobId: string) {
		const boss = this.getBossForQueue(queueName);
		this.assertJobId(jobId);
		return boss.retry(queueName, jobId);
	}

	async cancelJob(queueName: string, jobId: string) {
		const boss = this.getBossForQueue(queueName);
		this.assertJobId(jobId);
		return boss.cancel(queueName, jobId);
	}

	async getSchedules(): Promise<Schedule[]> {
		return this.getBoss().getSchedules();
	}

	async schedule(queueName: string, cron: string, data?: Record<string, unknown>): Promise<void> {
		await this.getBossForQueue(queueName).schedule(queueName, cron, data ?? {});
	}

	async unschedule(queueName: string): Promise<void> {
		await this.getBossForQueue(queueName).unschedule(queueName);
	}

	async getAdminTasks(): Promise<AdminTaskRunStatus[]> {
		const configs = await this.getAdminTaskConfigs();
		const boss = this.getBoss();
		return Promise.all(
			ADMIN_SCHEDULED_TASKS.map(async (task) => {
				const jobs = await boss.findJobs<object>(task.queue, { limit: 50 });
				jobs.sort((a, b) => b.createdOn.getTime() - a.createdOn.getTime());
				const now = Date.now();
				const relevant = jobs.filter((job) => job.state !== "created" || job.startAfter.getTime() <= now);
				const latest = relevant[0];
				const active = relevant.find((job) => job.state === "active");
				const queued = relevant.find((job) => job.state === "created" || job.state === "retry");
				const lastRunAt = latest ? (latest.startedOn ?? latest.createdOn).toISOString() : null;
				const lastError = latest?.state === "failed" ? this.jobError(latest) : undefined;
				return {
					id: task.id,
					name: task.name,
					category: task.category,
					description: task.description,
					enabled: configs[task.id].enabled,
					cron: configs[task.id].cron,
					state: active
						? "running"
						: queued
							? "queued"
							: latest?.state === "completed"
								? "completed"
								: latest?.state === "failed"
									? "failed"
									: latest?.state === "cancelled"
										? "cancelled"
										: "never",
					lastRunAt,
					...(lastError ? { lastError } : {}),
					...(active && this.activeTaskProgress.has(active.id)
						? { progress: this.activeTaskProgress.get(active.id) }
						: {}),
				};
			}),
		);
	}

	async saveAdminTaskSchedule(id: string, schedule: AdminScheduledTaskConfig): Promise<void> {
		if (!isAdminScheduledTaskId(id)) {
			throw new BadRequest("Unknown scheduled task.");
		}
		if (typeof schedule?.enabled !== "boolean" || typeof schedule.cron !== "string" || schedule.cron.length > 128) {
			throw new BadRequest("A schedule requires an enabled flag and a cron expression up to 128 characters.");
		}
		if (schedule.enabled && !schedule.cron.trim()) {
			throw new BadRequest("Enter a cron expression before enabling this schedule.");
		}
		const task = ADMIN_SCHEDULED_TASKS.find((entry) => entry.id === id);
		if (!task) throw new BadRequest("Unknown scheduled task.");
		const configs = await this.getAdminTaskConfigs();
		const next: AdminScheduledTaskConfigs = {
			...configs,
			[id]: { enabled: schedule.enabled, cron: schedule.cron.trim() },
		};
		const repository = this.dataSource.getRepository(Setting);
		const existingSetting = await repository.findOneBy({ key: ADMIN_SCHEDULED_TASKS_SETTING });
		const previousValue = existingSetting?.value;
		const setting = existingSetting ?? repository.create({ key: ADMIN_SCHEDULED_TASKS_SETTING, isPublic: false });
		setting.value = next;
		await repository.save(setting);
		try {
			if (schedule.enabled) {
				await this.getBoss().schedule(task.queue, next[id].cron, { taskId: id }, { tz: "UTC", group: { id } });
			} else {
				await this.getBoss().unschedule(task.queue);
			}
		} catch (error) {
			const rollbackErrors: unknown[] = [];
			try {
				if (configs[id].enabled) {
					await this.getBoss().schedule(
						task.queue,
						configs[id].cron,
						{ taskId: id },
						{ tz: "UTC", group: { id } },
					);
				} else {
					await this.getBoss().unschedule(task.queue);
				}
			} catch (rollbackError) {
				rollbackErrors.push(rollbackError);
			}
			try {
				if (existingSetting) {
					existingSetting.value = previousValue;
					await repository.save(existingSetting);
				} else {
					await repository.delete({ key: ADMIN_SCHEDULED_TASKS_SETTING });
				}
			} catch (rollbackError) {
				rollbackErrors.push(rollbackError);
			}
			if (rollbackErrors.length > 0) {
				throw new AggregateError(
					[error, ...rollbackErrors],
					"Schedule update failed and rollback was unsuccessful.",
				);
			}
			throw error;
		}
	}

	async runAdminTask(id: string): Promise<{ id: string | null }> {
		if (!isAdminScheduledTaskId(id)) {
			throw new BadRequest("Unknown scheduled task.");
		}
		const task = ADMIN_SCHEDULED_TASKS.find((entry) => entry.id === id)!;
		const jobs = await this.getBoss().findJobs<object>(task.queue, { limit: 50 });
		if (
			jobs.some(
				(job) =>
					job.state === "active" ||
					job.state === "retry" ||
					(job.state === "created" && job.startAfter.getTime() <= Date.now()),
			)
		) {
			throw new BadRequest("This task is already running or queued.");
		}
		const jobId = await this.getBoss().send(task.queue, { taskId: id }, { group: { id } });
		return { id: jobId };
	}

	async stopAdminTask(id: string): Promise<{ stopped: boolean }> {
		if (!isAdminScheduledTaskId(id)) {
			throw new BadRequest("Unknown scheduled task.");
		}
		const task = ADMIN_SCHEDULED_TASKS.find((entry) => entry.id === id)!;
		const jobs = await this.getBoss().findJobs<object>(task.queue, { limit: 50 });
		const active = jobs.filter((job) => job.state === "active");
		for (const job of active) {
			this.activeTaskControllers.get(job.id)?.abort();
			await this.getBoss().cancel(task.queue, job.id);
		}
		const queued = jobs.filter(
			(job) => job.state === "retry" || (job.state === "created" && job.startAfter.getTime() <= Date.now()),
		);
		for (const job of queued) {
			await this.getBoss().cancel(task.queue, job.id);
		}
		return { stopped: active.length + queued.length > 0 };
	}

	private getBoss(): PgBoss {
		if (!this.boss) {
			throw new Error("The pg-boss scheduler is not initialized.");
		}
		return this.boss;
	}

	private getBossForQueue(queueName: string): PgBoss {
		if (!SUPPORTED_JOB_QUEUES.has(queueName)) {
			throw new BadRequest(`Unsupported job queue: ${queueName}.`);
		}
		return this.getBoss();
	}

	private assertJobId(jobId: string): void {
		if (!JOB_ID_PATTERN.test(jobId)) {
			throw new BadRequest("Job ID must be a valid UUID.");
		}
	}

	private async getAdminTaskConfigs(initialize = false): Promise<AdminScheduledTaskConfigs> {
		const repository = this.dataSource.getRepository(Setting);
		let setting = await repository.findOneBy({ key: ADMIN_SCHEDULED_TASKS_SETTING });
		if (!setting) {
			const defaults = defaultAdminScheduledTaskConfigs();
			if (initialize) {
				setting = repository.create({ key: ADMIN_SCHEDULED_TASKS_SETTING, value: defaults, isPublic: false });
				await repository.save(setting);
			}
			return defaults;
		}
		const stored = setting.value;
		if (typeof stored !== "object" || stored === null || Array.isArray(stored)) {
			throw new Error("Stored scheduled task configuration is invalid.");
		}
		const configs = defaultAdminScheduledTaskConfigs();
		for (const task of ADMIN_SCHEDULED_TASKS) {
			const value = (stored as Record<string, unknown>)[task.id];
			if (value === undefined) continue;
			if (
				typeof value !== "object" ||
				value === null ||
				typeof (value as Record<string, unknown>).enabled !== "boolean" ||
				typeof (value as Record<string, unknown>).cron !== "string"
			) {
				throw new Error(`Stored schedule for ${task.id} is invalid.`);
			}
			configs[task.id] = value as AdminScheduledTaskConfig;
		}
		return configs;
	}

	private async processAdminTask(id: AdminScheduledTaskId, jobs: Job<{ taskId?: string }>[]): Promise<void> {
		const job = jobs[0];
		if (!job || job.signal.aborted) return;
		const controller = new AbortController();
		this.activeTaskControllers.set(job.id, controller);
		const signal = AbortSignal.any([job.signal, controller.signal]);
		try {
			switch (id) {
				case "scan-libraries":
				case "refresh-metadata":
				case "trickplay":
					await this.runIndexerTask(id, job.id, signal);
					break;
				case "clean-transcode":
					await this.requestStreamerCleanup(signal);
					break;
				case "clean-logs":
					await this.cleanOldLogs(signal);
					break;
				case "optimize-database":
					await this.optimizeDatabase(signal);
					break;
			}
			logger().info(signal.aborted ? `Scheduled task ${id} stopped.` : `Scheduled task ${id} completed.`);
		} catch (error) {
			if (!signal.aborted) {
				logger().error(`Scheduled task ${id} failed.`, error);
				this.sentryService.captureException(error);
				throw error;
			}
			if (!(error instanceof Error && error.name === "AbortError")) {
				logger().error(`Scheduled task ${id} stopped with an error.`, error);
			}
			logger().info(`Scheduled task ${id} stopped.`);
		} finally {
			this.activeTaskControllers.delete(job.id);
			this.activeTaskProgress.delete(job.id);
		}
	}

	private async runIndexerTask(
		id: "scan-libraries" | "refresh-metadata" | "trickplay",
		jobId: string,
		signal: AbortSignal,
	): Promise<void> {
		const libraries = await this.libraries.forIndexer();
		if (libraries.length === 0) return;
		const before = await this.indexer.request<{ scans: IndexerScanState[] }>("GET", "/internal/stats", { signal });
		const previousScans = new Map((before.scans ?? []).map((scan) => [scan.libraryId, scan.startedAt]));
		const requested = new Map<string, string | undefined>();
		const progressByLibrary = new Map<string, IndexerScanState>();
		const inFlight = new Set<string>();
		try {
			for (const library of libraries) {
				if (signal.aborted) throw new Error("Scheduled indexer task was stopped.");
				const body =
					id === "scan-libraries"
						? { libraryId: library.id }
						: id === "refresh-metadata"
							? { libraryId: library.id, jobs: ["images", "descriptions"], trackProgress: true }
							: { libraryId: library.id, trickplayOnly: true, trackProgress: true };
				inFlight.add(library.id);
				let result: { queued: boolean };
				try {
					result = await this.indexer.request<{ queued: boolean }>("POST", "/internal/scan", {
						body,
						signal,
					});
				} catch (error) {
					if (!signal.aborted) inFlight.delete(library.id);
					throw error;
				}
				inFlight.delete(library.id);
				if (result.queued) requested.set(library.id, previousScans.get(library.id));
			}
			while (!signal.aborted && requested.size > 0) {
				const status = await this.indexer.request<{ scans: IndexerScanState[] }>("GET", "/internal/stats", {
					signal,
				});
				const scans = new Map((status.scans ?? []).map((scan) => [scan.libraryId, scan]));
				const scanProgress = [...requested].flatMap(([libraryId, previousStartedAt]) => {
					const scan = scans.get(libraryId);
					return scan && scan.startedAt !== previousStartedAt ? [scan] : [];
				});
				for (const scan of scanProgress) progressByLibrary.set(scan.libraryId, scan);
				const total = [...progressByLibrary.values()].reduce((sum, scan) => sum + scan.discovered, 0);
				const done = [...progressByLibrary.values()].reduce((sum, scan) => sum + scan.done, 0);
				if (total > 0) this.activeTaskProgress.set(jobId, Math.min(99, Math.floor((done / total) * 100)));
				const failedScan = scanProgress.find((scan) => scan.state === "failed");
				if (failedScan) {
					throw new Error(failedScan.error || `The scan for library ${failedScan.libraryId} failed.`);
				}
				for (const scan of scanProgress) {
					if (scan.state === "complete") {
						requested.delete(scan.libraryId);
					}
				}
				if (requested.size === 0) {
					this.activeTaskProgress.set(jobId, 100);
					break;
				}
				await this.wait(5_000, signal);
			}
		} catch (error) {
			if (!signal.aborted) throw error;
		} finally {
			if (signal.aborted) {
				await Promise.all(
					[...new Set([...requested.keys(), ...inFlight])].map((libraryId) =>
						this.indexer.request(
							"POST",
							`/internal/libraries/${encodeURIComponent(libraryId)}/cancel-tasks`,
						),
					),
				);
			}
		}
	}

	private wait(delayMs: number, signal: AbortSignal): Promise<void> {
		if (signal.aborted) return Promise.resolve();
		return new Promise((resolve) => {
			const timer = setTimeout(done, delayMs);
			const onAbort = () => done();
			function done() {
				clearTimeout(timer);
				signal.removeEventListener("abort", onAbort);
				resolve();
			}
			signal.addEventListener("abort", onAbort, { once: true });
		});
	}

	private async requestStreamerCleanup(signal: AbortSignal): Promise<void> {
		const baseUrl = (appConfig().get("streamerInternalUrl") || "http://localhost:8091").replace(/\/+$/, "");
		const secret = appConfig().get("appSecret") ?? "";
		if (Buffer.byteLength(secret) < 32)
			throw new Error("APP_SECRET must be set to at least 32 bytes to call flixer-streamer.");
		const adminKey = createHmac("sha256", secret).update("flixer-streamer:admin:v1").digest("hex");
		const response = await fetch(`${baseUrl}/streamer/admin/transcode-cache/cleanup`, {
			method: "POST",
			headers: { authorization: `Bearer ${adminKey}` },
			signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
		});
		if (!response.ok) throw new Error(`flixer-streamer cleanup returned status ${response.status}.`);
	}

	private async cleanOldLogs(signal: AbortSignal): Promise<void> {
		const directory = logDirectory();
		if (!directory) throw new Error("The log directory is not configured.");
		const entries = await readdir(directory, { withFileTypes: true });
		const cutoff = Date.now() - LOG_RETENTION_MS;
		for (const entry of entries) {
			if (signal.aborted) return;
			if (!entry.isFile() || !/\.log\.\d+$/.test(entry.name)) continue;
			const path = join(directory, entry.name);
			const info = await stat(path);
			if (info.mtimeMs < cutoff) await unlink(path);
		}
	}

	private async optimizeDatabase(signal: AbortSignal): Promise<void> {
		if (signal.aborted) return;
		const runner = this.dataSource.createQueryRunner();
		await runner.connect();
		try {
			const [row] = await runner.query("SELECT pg_backend_pid() AS pid");
			const pid = Number(row?.pid);
			if (!Number.isInteger(pid)) throw new Error("Could not identify the PostgreSQL optimization connection.");
			const cancelQuery = () => {
				void this.dataSource.query("SELECT pg_cancel_backend($1)", [pid]).catch((error: unknown) => {
					logger().warn("Could not cancel PostgreSQL optimization query.", error);
				});
			};
			signal.addEventListener("abort", cancelQuery, { once: true });
			try {
				if (signal.aborted) cancelQuery();
				await runner.query("VACUUM (ANALYZE)");
			} finally {
				signal.removeEventListener("abort", cancelQuery);
			}
		} finally {
			await runner.release();
		}
	}

	private jobError(job: JobWithMetadata<object>): string | undefined {
		if (typeof job.output === "string") return job.output;
		if (job.output && typeof job.output === "object") {
			const value = (job.output as Record<string, unknown>).message;
			if (typeof value === "string") return value;
		}
		return undefined;
	}
}
