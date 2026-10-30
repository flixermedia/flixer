import { describe, expect, it } from "vitest";
import type { DataSource } from "typeorm";
import { IndexerSettingsService, INDEXER_PROVIDERS_KEY } from "./indexerSettingsService.js";

describe("IndexerSettingsService", () => {
	it("defaults TheIntroDB on while preserving an explicit disable and omitted provider settings", () => {
		const service = new IndexerSettingsService({} as DataSource);
		const updated = service.validate(INDEXER_PROVIDERS_KEY, { tmdb: { enabled: true } }, {
			tmdb: { enabled: true, apiKey: "stored" },
			theintrodb: { enabled: false },
		});

		expect(updated).toEqual({
			tmdb: { enabled: true, apiKey: "stored" },
			theintrodb: { enabled: false },
			introdb: { enabled: true },
		});
		expect(service.validate(INDEXER_PROVIDERS_KEY, { tmdb: { enabled: true } }, {})).toMatchObject({
			tmdb: { enabled: true },
			theintrodb: { enabled: true },
			introdb: { enabled: true },
		});
	});

	it("accepts and masks an optional TheIntroDB API key", () => {
		const service = new IndexerSettingsService({} as DataSource);
		const settings = service.validate(INDEXER_PROVIDERS_KEY, {
			theintrodb: { enabled: true, apiKey: "intro-secret" },
		}, {}) as Record<string, { enabled: boolean; apiKey?: string }>;

		expect(settings.theintrodb).toEqual({ enabled: true, apiKey: "intro-secret" });
		expect(service.mask(INDEXER_PROVIDERS_KEY, settings)).toMatchObject({
			theintrodb: { enabled: true, apiKey: "********" },
		});
		expect(service.validate(INDEXER_PROVIDERS_KEY, {
			theintrodb: { enabled: true, apiKey: "********" },
		}, settings)).toEqual(settings);
	});
});
