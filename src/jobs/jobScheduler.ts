import { Inject, Injectable, logger } from "@tsed/di";
import { tryCatch } from "@dschz/try-catch";
import { BadRequest } from "@tsed/exceptions";
import { PgBoss, type JobWithMetadata, type QueueResult, type Schedule } from "pg-boss";
import { DataSource } from "typeorm";
import { DefaultDataSource } from "../datasources/defaultDataSource.datasource.js";
import { SentryService } from "../sentry/sentryService.js";
import { cleanupExpiredUserSessions, SESSION_CLEANUP_JOB } from "./sessionCleanupJob.js";

const SESSION_CLEANUP_CRON = "0 * * * *";
const PG_BOSS_CONNECTION_POOL_SIZE = 2;
const SCHEDULER_SHUTDOWN_TIMEOUT_MS = 30_000;
const SUPPORTED_JOB_QUEUES = new Set([SESSION_CLEANUP_JOB]);
const JOB_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
export class JobScheduler {

	private boss?: PgBoss;

	constructor(
		@Inject(DefaultDataSource) private readonly dataSource: DataSource,
		private readonly sentryService: SentryService,
	) {}

	async $onInit(): Promise<void> {
		const connectionString = process.env.DATABASE_URL;
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
}
