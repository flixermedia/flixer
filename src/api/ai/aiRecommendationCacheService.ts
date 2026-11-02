import { BadRequest } from "@tsed/exceptions";
import { Inject, Injectable } from "@tsed/di";
import { DataSource, In } from "typeorm";
import { DefaultDataSource } from "../../datasources/defaultDataSource.datasource.js";
import { AiRecommendationCache } from "../../entities/aiRecommendationCache.entity.js";
import { MediaItem } from "../../entities/mediaItem.entity.js";

interface CachedRecommendationResponse {
	items: Array<{
		id: string;
		score: number;
		reason?: string | null;
	}>;
}

interface RecommendationCacheState {
	entries: Record<string, CachedRecommendationResponse>;
	lastRefreshAt: string | null;
	entryScopes: Record<string, "movies" | "music" | "general">;
	refreshTimes: Record<string, string>;
}

interface RecommendationCacheUserRow {
	userId: string;
	username: string;
	displayName: string;
	entries: Record<string, CachedRecommendationResponse> | null;
	entryScopes: Record<string, "movies" | "music" | "general"> | null;
	lastRefreshAt: Date | string | null;
}

const CACHE_KEY_PATTERN = /^[a-f0-9]{64}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCachedRecommendationResponse(value: unknown): value is CachedRecommendationResponse {
	if (!isRecord(value) || !Array.isArray(value.items)) {
		return false;
	}
	return value.items.every((item) => {
		if (!isRecord(item) || typeof item.id !== "string" || typeof item.score !== "number" || !Number.isFinite(item.score) || item.score < 0 || item.score > 1) {
			return false;
		}
		return item.reason === undefined || item.reason === null || typeof item.reason === "string";
	});
}

function validateState(value: unknown): RecommendationCacheState {
	if (!isRecord(value) || !isRecord(value.entries)) {
		throw new BadRequest("Invalid recommendation cache state.");
	}
	if ((value.entryScopes !== undefined && !isRecord(value.entryScopes)) || (value.refreshTimes !== undefined && !isRecord(value.refreshTimes))) {
		throw new BadRequest("Invalid recommendation cache metadata.");
	}

	const entries: RecommendationCacheState["entries"] = {};
	const entryScopes: RecommendationCacheState["entryScopes"] = {};
	const suppliedScopes = value.entryScopes ?? {};
	for (const [key, scope] of Object.entries(suppliedScopes)) {
		if (!CACHE_KEY_PATTERN.test(key) || (scope !== "movies" && scope !== "music" && scope !== "general")) {
			throw new BadRequest("Invalid recommendation cache scope.");
		}
	}
	for (const [key, response] of Object.entries(value.entries)) {
		if (!CACHE_KEY_PATTERN.test(key) || !isCachedRecommendationResponse(response)) {
			throw new BadRequest("Invalid recommendation cache entry.");
		}
		entries[key] = response;
		const scope = suppliedScopes[key] ?? "movies";
		if (scope !== "movies" && scope !== "music" && scope !== "general") {
			throw new BadRequest("Invalid recommendation cache scope.");
		}
		entryScopes[key] = scope;
	}

	const lastRefreshAt = value.lastRefreshAt;
	if (lastRefreshAt !== null && (typeof lastRefreshAt !== "string" || !Number.isFinite(Date.parse(lastRefreshAt)))) {
		throw new BadRequest("Invalid recommendation cache refresh time.");
	}

	const refreshTimes: RecommendationCacheState["refreshTimes"] = {};
	const suppliedRefreshTimes = value.refreshTimes ?? {};
	for (const [scope, refreshedAt] of Object.entries(suppliedRefreshTimes)) {
		if ((scope !== "movies" && scope !== "music" && scope !== "general") || typeof refreshedAt !== "string" || !Number.isFinite(Date.parse(refreshedAt))) {
			throw new BadRequest("Invalid recommendation cache refresh time.");
		}
		refreshTimes[scope] = refreshedAt;
	}
	if (Object.keys(refreshTimes).length === 0 && lastRefreshAt !== null) {
		refreshTimes.movies = lastRefreshAt;
	}

	return { entries, lastRefreshAt, entryScopes, refreshTimes };
}

@Injectable()
export class AiRecommendationCacheService {
	constructor(@Inject(DefaultDataSource) private readonly dataSource: DataSource) {}

	async listUsers() {
		const rows = (await this.dataSource.query(`
			SELECT
				u.id AS "userId",
				u.username AS "username",
				COALESCE(u.display_name, u.username) AS "displayName",
				c.entries AS "entries",
				c.entry_scopes AS "entryScopes",
				c.last_refresh_at AS "lastRefreshAt"
			FROM users u
			LEFT JOIN ai_recommendation_caches c ON c.user_id = u.id
			ORDER BY u.username
		`)) as RecommendationCacheUserRow[];
		const mediaIds = new Set<string>();
		for (const row of rows) {
			for (const response of Object.values(row.entries ?? {})) {
				if (isCachedRecommendationResponse(response)) {
					for (const item of response.items) mediaIds.add(item.id);
				}
			}
		}
		const media = mediaIds.size
			? await this.dataSource.getRepository(MediaItem).find({
					where: { id: In([...mediaIds]) },
					select: { id: true, title: true, type: true },
				})
			: [];
		const mediaById = new Map(media.map((item) => [item.id, item]));

		return rows.map((row) => ({
			userId: row.userId,
			username: row.username,
			displayName: row.displayName,
			lastRefreshAt: row.lastRefreshAt instanceof Date ? row.lastRefreshAt.toISOString() : row.lastRefreshAt,
			entries: Object.entries(row.entries ?? {})
				.filter(([key, response]) => CACHE_KEY_PATTERN.test(key) && isCachedRecommendationResponse(response))
				.map(([key, response]) => ({
					key,
					scope: row.entryScopes?.[key] ?? "movies",
					items: response.items.map((item) => ({
						...item,
						title: mediaById.get(item.id)?.title ?? item.id,
						type: mediaById.get(item.id)?.type ?? null,
					})),
				})),
		}));
	}

	async get(userId: string): Promise<RecommendationCacheState> {
		const row = await this.dataSource.getRepository(AiRecommendationCache).findOneBy({ userId });
		return {
			entries: (row?.entries as RecommendationCacheState["entries"]) ?? {},
			lastRefreshAt: row?.lastRefreshAt?.toISOString() ?? null,
			entryScopes: row?.entryScopes ?? {},
			refreshTimes: row?.refreshTimes ?? {},
		};
	}

	async save(userId: string, value: unknown): Promise<void> {
		const state = validateState(value);
		await this.dataSource.getRepository(AiRecommendationCache).upsert(
			{
				userId,
				entries: state.entries,
				lastRefreshAt: state.lastRefreshAt === null ? null : new Date(state.lastRefreshAt),
				entryScopes: state.entryScopes,
				refreshTimes: state.refreshTimes,
			},
			["userId"],
		);
	}

	async clear(): Promise<void> {
		await this.dataSource.createQueryBuilder().delete().from(AiRecommendationCache).execute();
	}
}
