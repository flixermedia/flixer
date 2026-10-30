import { Inject, Injectable } from "@tsed/di";
import { BadRequest } from "@tsed/exceptions";
import { DataSource } from "typeorm";
import { DefaultDataSource } from "../../datasources/defaultDataSource.datasource.js";
import { Setting } from "../../entities/setting.entity.js";
import { IndexerClient } from "./indexerClient.js";
import {
	INDEXER_CONCURRENCY_KEY,
	IndexerSettingsService,
	type IndexerQueueName,
	type IndexerTaskQueueName,
} from "./indexerSettingsService.js";

export type IndexerScanState = "scanning" | "indexing" | "complete" | "failed";
export const INDEXER_TASK_STATES = ["pending", "active", "scheduled", "retry", "archived", "completed"] as const;
export type IndexerTaskState = (typeof INDEXER_TASK_STATES)[number];

export interface IndexerScan {
	libraryId: string;
	state: IndexerScanState;
	discovered: number;
	done: number;
	failed: number;
	startedAt?: string;
	finishedAt?: string;
	error?: string;
}

export interface IndexerQueueStats {
	queue: IndexerQueueName;
	pending: number;
	active: number;
	scheduled: number;
	retry: number;
	archived: number;
	completed: number;
	processed: number;
	failed: number;
	paused: boolean;
	latencyMs: number;
}

export interface IndexerTask {
	id: string;
	queue: IndexerTaskQueueName;
	type: string;
	state: IndexerTaskState;
	retried: number;
	maxRetry: number;
	lastError?: string;
	lastFailedAt?: string;
	libraryId?: string;
	libraryName?: string;
	itemType?: string;
	path?: string;
}

export interface IndexerTaskPage {
	queue: IndexerTaskQueueName;
	state: IndexerTaskState;
	page: number;
	tasks: IndexerTask[];
}

export interface IndexerTaskLogEntry {
	time: string;
	level: string;
	message: string;
}

export interface IndexerTaskLogs {
	queue: IndexerTaskQueueName;
	id: string;
	state: IndexerTaskState | "";
	total: number;
	entries: IndexerTaskLogEntry[];
}

export interface IndexerStatus {
	reachable: boolean;
	scans: IndexerScan[];
	queues: IndexerQueueStats[];
	concurrency: Record<string, number>;
	maxConcurrency: number | null;
	enabledProviders: string[];
}

interface IndexerStats {
	queues?: IndexerQueueStats[];
	enabledProviders?: string[];
}

@Injectable()
export class AdminIndexerService {

	constructor(
		@Inject(DefaultDataSource) private readonly dataSource: DataSource,
		private readonly indexer: IndexerClient,
		private readonly settings: IndexerSettingsService,
	) {}

	async status(): Promise<IndexerStatus> {
		const stored = (await this.settings.forIndexer()).concurrency;
		try {
			const [scans, stats, concurrency] = await Promise.all([
				this.indexer.request<{ scans?: IndexerScan[] }>("GET", "/internal/scans"),
				this.indexer.request<IndexerStats>("GET", "/internal/stats"),
				this.indexer.request<{ concurrency?: Record<string, number>; max?: number }>(
					"GET",
					"/internal/concurrency",
				),
			]);
			return {
				reachable: true,
				scans: scans?.scans ?? [],
				queues: stats?.queues ?? [],
				concurrency: concurrency?.concurrency ?? stored,
				maxConcurrency: concurrency?.max ?? null,
				enabledProviders: stats?.enabledProviders ?? [],
			};
		} catch {
			return {
				reachable: false,
				scans: [],
				queues: [],
				concurrency: stored,
				maxConcurrency: null,
				enabledProviders: [],
			};
		}
	}

	/** Saves worker counts in flixer so they survive restarts, then tells the indexer to apply them. */
	async setConcurrency(request: Record<string, unknown>): Promise<IndexerStatus> {
		const repository = this.dataSource.getRepository(Setting);
		const setting = await repository.findOneBy({ key: INDEXER_CONCURRENCY_KEY });
		if (!setting) {
			throw new BadRequest("The indexer_concurrency setting is missing.");
		}
		const current =
			typeof setting.value === "object" && setting.value !== null
				? (setting.value as Record<string, unknown>)
				: {};
		setting.value = this.settings.validate(INDEXER_CONCURRENCY_KEY, { ...current, ...request }, current);
		await repository.save(setting);
		await this.indexer.reloadSettings();
		return this.status();
	}
}
