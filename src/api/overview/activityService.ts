import { Inject, Injectable } from "@tsed/di";
import { BadRequest } from "@tsed/exceptions";
import { DataSource } from "typeorm";
import { DefaultDataSource } from "../../datasources/defaultDataSource.datasource.js";
import { MediaItem } from "../../entities/mediaItem.entity.js";
import { User } from "../../entities/user.entity.js";
import { WatchProgress } from "../../entities/watchProgress.entity.js";
import { AuthService } from "../auth/authService.js";

export interface ActivityRow {
	user_name: string;
	title: string;
	type: string;
	parent_title: string | null;
	season_number: number | null;
	episode_number: number | null;
	position_seconds: number;
	duration_seconds: number;
	completed: boolean;
	updated_at: Date;
}

export function activityQuery(dataSource: DataSource) {
	// RAW SQL: COALESCE expressions preserve the existing user and parent fallback rules.
	return dataSource.getRepository(WatchProgress).createQueryBuilder("w").innerJoin(User, "u", "u.id = w.userId").innerJoin(MediaItem, "i", "i.id = w.itemId").leftJoin(MediaItem, "season", "season.id = i.parentId AND i.type = 'episode'").leftJoin(MediaItem, "parent", "parent.id = COALESCE(season.parentId, i.parentId)").select("COALESCE(u.displayName, u.username)", "user_name").addSelect("i.title", "title").addSelect("i.type", "type").addSelect("parent.title", "parent_title").addSelect("COALESCE(i.seasonNumber, season.seasonNumber)", "season_number").addSelect("i.episodeNumber", "episode_number").addSelect("w.positionSeconds", "position_seconds").addSelect("w.durationSeconds", "duration_seconds").addSelect("w.completed", "completed").addSelect("w.updatedAt", "updated_at");
}

export function mapActivityRow(row: ActivityRow) {
	return {
		user: row.user_name,
		title: row.title,
		type: row.type,
		showTitle: row.type === "episode" || row.type === "track" ? row.parent_title : null,
		seasonNumber: row.season_number,
		episodeNumber: row.episode_number,
		positionSeconds: row.position_seconds,
		durationSeconds: row.duration_seconds,
		completed: row.completed,
		at: row.updated_at,
	};
}

interface ActivityQuery {
	search?: string;
	user?: string;
	type?: string;
	status?: string;
	from?: string;
	to?: string;
	sort?: string;
	page?: string;
	pageSize?: string;
}

const TYPES = ["movie", "episode", "track", "video"];
const STATUSES = ["finished", "in_progress"];
const SORTS: Record<string, [string, "ASC" | "DESC"][]> = {
	recent: [["w.updatedAt", "DESC"]],
	oldest: [["w.updatedAt", "ASC"]],
	user: [
		["user_name", "ASC"],
		["w.updatedAt", "DESC"],
	],
	title: [
		["i.title", "ASC"],
		["w.updatedAt", "DESC"],
	],
};
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 25;

/** Searchable, filterable, paged view of everything users have watched, for the admin activity page. */
@Injectable()
export class ActivityService {

	constructor(@Inject(DefaultDataSource) private readonly dataSource: DataSource) {}

	async list(query: ActivityQuery) {
		const params: Record<string, unknown> = {};
		const where: string[] = [];
		const bind = (sql: string, value: unknown) => {
			const name = `filter${Object.keys(params).length}`;
			params[name] = value;
			where.push(sql.replaceAll("?", `:${name}`));
		};

		const search = query.search?.trim().slice(0, 100);
		if (search) {
			bind(`(i.title ILIKE ? ESCAPE '\\' OR parent.title ILIKE ? ESCAPE '\\' OR u.username ILIKE ? ESCAPE '\\' OR u.display_name ILIKE ? ESCAPE '\\')`, `%${search.replace(/[\\%_]/g, "\\$&")}%`);
		}
		if (query.user) {
			if (!AuthService.isUuid(query.user)) {
				throw new BadRequest("Unknown user.");
			}
			bind("w.user_id = ?", query.user.toLowerCase());
		}
		if (query.type) {
			if (!TYPES.includes(query.type)) {
				throw new BadRequest(`type must be one of ${TYPES.join(", ")}.`);
			}
			bind("i.type = ?", query.type);
		}
		if (query.status) {
			if (!STATUSES.includes(query.status)) {
				throw new BadRequest(`status must be one of ${STATUSES.join(", ")}.`);
			}
			where.push(query.status === "finished" ? "w.completed = true" : "w.completed = false");
		}
		for (const [name, sql] of [
			["from", "w.updated_at >= ?::date"],
			["to", "w.updated_at < (?::date + 1)"],
		] as const) {
			const value = query[name];
			if (value) {
				if (!DATE_PATTERN.test(value) || Number.isNaN(Date.parse(value))) {
					throw new BadRequest(`${name} must be a date like 2026-01-31.`);
				}
				bind(sql, value);
			}
		}

		const sort = query.sort ?? "recent";
		if (!SORTS[sort]) {
			throw new BadRequest(`sort must be one of ${Object.keys(SORTS).join(", ")}.`);
		}
		const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number.parseInt(query.pageSize ?? "", 10) || DEFAULT_PAGE_SIZE));
		const page = Math.max(1, Number.parseInt(query.page ?? "", 10) || 1);
		const base = activityQuery(this.dataSource).where(where.join(" AND ") || "1=1", params);
		const list = base.clone();
		for (const [index, [column, direction]] of SORTS[sort].entries()) {
			if (index === 0) list.orderBy(column, direction);
			else list.addOrderBy(column, direction);
		}

		const [summary, rows, users] = await Promise.all([
			// RAW SQL: PostgreSQL FILTER and casts preserve the summary's integer result shape.
			base.clone().select("COUNT(*)::int", "total").addSelect("COUNT(*) FILTER (WHERE w.completed)::int", "finished").addSelect("COUNT(DISTINCT w.userId)::int", "users").getRawOne<{ total: number; finished: number; users: number }>(),
			list
				.limit(pageSize)
				.offset((page - 1) * pageSize)
				.getRawMany<ActivityRow>(),
			// RAW SQL: COALESCE preserves the display-name fallback.
			this.dataSource.getRepository(User).createQueryBuilder("u").select("u.id", "id").addSelect("COALESCE(u.displayName, u.username)", "name").orderBy("name", "ASC").getRawMany<{ id: string; name: string }>(),
		]);

		const { total, finished, users: activeUsers } = summary ?? { total: 0, finished: 0, users: 0 };
		return {
			items: rows.map(mapActivityRow),
			page,
			pageSize,
			total,
			summary: { total, finished, inProgress: total - finished, users: activeUsers },
			users,
		};
	}
}
