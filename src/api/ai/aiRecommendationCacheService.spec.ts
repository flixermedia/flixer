import { BadRequest } from "@tsed/exceptions";
import { describe, expect, it, vi } from "vitest";
import type { DataSource } from "typeorm";
import { AiRecommendationCache } from "../../entities/aiRecommendationCache.entity.js";
import { MediaItem } from "../../entities/mediaItem.entity.js";
import { AiRecommendationCacheService } from "./aiRecommendationCacheService.js";

describe("AiRecommendationCacheService", () => {
	it("persists per-user entries and refresh time", async () => {
		const repository = {
			findOneBy: vi.fn(async () => ({
				userId: "user-id",
				entries: { ["a".repeat(64)]: { items: [{ id: "media-id", score: 0.8 }] } },
				lastRefreshAt: new Date("2026-11-02T00:00:00.000Z"),
				entryScopes: { ["a".repeat(64)]: "music" },
				refreshTimes: { music: "2026-11-02T00:00:00.000Z" },
			})),
			upsert: vi.fn(async () => undefined),
		};
		const queryBuilder = { delete: vi.fn().mockReturnThis(), from: vi.fn().mockReturnThis(), execute: vi.fn() };
		const dataSource = {
			getRepository: vi.fn(() => repository),
			createQueryBuilder: vi.fn(() => queryBuilder),
		} as unknown as DataSource;
		const service = new AiRecommendationCacheService(dataSource);
		const state = {
			entries: { ["a".repeat(64)]: { items: [{ id: "media-id", score: 0.8 }] } },
			lastRefreshAt: "2026-11-02T00:00:00.000Z",
			entryScopes: { ["a".repeat(64)]: "music" as const },
			refreshTimes: { music: "2026-11-02T00:00:00.000Z" },
		};

		await expect(service.get("user-id")).resolves.toEqual(state);
		await service.save("user-id", state);
		expect(repository.upsert).toHaveBeenCalledWith(
			{
				userId: "user-id",
				entries: state.entries,
				lastRefreshAt: new Date(state.lastRefreshAt),
				entryScopes: state.entryScopes,
				refreshTimes: state.refreshTimes,
			},
			["userId"],
		);
		await service.clear();
		expect(queryBuilder.from).toHaveBeenCalledWith(AiRecommendationCache);
	});

	it("rejects malformed or unkeyed cache entries", async () => {
		const dataSource = {} as DataSource;
		const service = new AiRecommendationCacheService(dataSource);

		await expect(service.save("user-id", { entries: { invalid: { items: [] } }, lastRefreshAt: null })).rejects.toThrow(BadRequest);
		await expect(service.save("user-id", { entries: {}, lastRefreshAt: "not-a-date" })).rejects.toThrow(BadRequest);
		await expect(service.save("user-id", { entries: {}, lastRefreshAt: null, refreshTimes: [] })).rejects.toThrow(BadRequest);
	});

	it("lists cached results by user with media titles", async () => {
		const key = "a".repeat(64);
		const dataSource = {
			query: vi.fn(async () => [
				{
					userId: "user-id",
					username: "ashley",
					displayName: "Ashley",
					entries: { [key]: { items: [{ id: "media-id", score: 0.8 }] } },
					entryScopes: { [key]: "music" },
					lastRefreshAt: new Date("2026-11-02T00:00:00.000Z"),
				},
			]),
			getRepository: vi.fn((entity) => (entity === MediaItem ? { find: vi.fn(async () => [{ id: "media-id", title: "Movie title", type: "movie" }]) } : {})),
		} as unknown as DataSource;
		const users = await new AiRecommendationCacheService(dataSource).listUsers();

		expect(users).toEqual([
			{
				userId: "user-id",
				username: "ashley",
				displayName: "Ashley",
				lastRefreshAt: "2026-11-02T00:00:00.000Z",
				entries: [
					{
						key,
						scope: "music",
						items: [{ id: "media-id", score: 0.8, title: "Movie title", type: "movie" }],
					},
				],
			},
		]);
	});
});
