import { Inject, Injectable } from "@tsed/di";
import { BadRequest } from "@tsed/exceptions";
import { DataSource } from "typeorm";
import { DefaultDataSource } from "../../datasources/defaultDataSource.datasource.js";
import { Setting } from "../../entities/setting.entity.js";
import { IndexerClient } from "./indexerClient.js";
import { INDEXER_CONCURRENCY_KEY, IndexerSettingsService } from "./indexerSettingsService.js";

export interface IndexerStatus {
	reachable: boolean;
	scans: unknown[];
	queues: unknown[];
	concurrency: Record<string, number>;
	maxConcurrency: number | null;
	enabledProviders: string[];
}

interface IndexerStats {
	queues?: unknown[];
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
				this.indexer.request<{ scans?: unknown[] }>("GET", "/internal/scans"),
				this.indexer.request<IndexerStats>("GET", "/internal/stats"),
				this.indexer.request<{ concurrency?: Record<string, number>; max?: number }>("GET", "/internal/concurrency"),
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
			return { reachable: false, scans: [], queues: [], concurrency: stored, maxConcurrency: null, enabledProviders: [] };
		}
	}

	/** Saves worker counts in flixer so they survive restarts, then tells the indexer to apply them. */
	async setConcurrency(request: Record<string, unknown>): Promise<IndexerStatus> {
		const repository = this.dataSource.getRepository(Setting);
		const setting = await repository.findOneBy({ key: INDEXER_CONCURRENCY_KEY });
		if (!setting) {
			throw new BadRequest("The indexer_concurrency setting is missing.");
		}
		const current = typeof setting.value === "object" && setting.value !== null ? (setting.value as Record<string, unknown>) : {};
		setting.value = this.settings.validate(INDEXER_CONCURRENCY_KEY, { ...current, ...request }, current);
		await repository.save(setting);
		await this.indexer.reloadSettings();
		return this.status();
	}
}
