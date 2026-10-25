import { Inject, Injectable } from "@tsed/di";
import { BadRequest } from "@tsed/exceptions";
import { DataSource } from "typeorm";
import { DefaultDataSource } from "../../datasources/defaultDataSource.datasource.js";
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

export const ACTIVITY_SELECT = `COALESCE(u.display_name, u.username) AS user_name, i.title, i.type, parent.title AS parent_title,
	COALESCE(i.season_number, season.season_number) AS season_number, i.episode_number,
	w.position_seconds, w.duration_seconds, w.completed, w.updated_at`;

export const ACTIVITY_FROM = `FROM watch_progress w
	JOIN users u ON u.id = w.user_id
	JOIN media_items i ON i.id = w.item_id
	LEFT JOIN media_items season ON season.id = i.parent_id AND i.type = 'episode'
	LEFT JOIN media_items parent ON parent.id = COALESCE(season.parent_id, i.parent_id)`;

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

export interface ActivityQuery {
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
const SORTS: Record<string, string> = {
	recent: "w.updated_at DESC",
	oldest: "w.updated_at ASC",
	user: "user_name ASC, w.updated_at DESC",
	title: "i.title ASC, w.updated_at DESC",
};
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 25;

/** Searchable, filterable, paged view of everything users have watched, for the admin activity page. */
@Injectable()
export class ActivityService {

	constructor(@Inject(DefaultDataSource) private readonly dataSource: DataSource) {}

	async list(query: ActivityQuery) {
		const params: unknown[] = [];
		const where: string[] = [];
		const bind = (sql: string, value: unknown) => {
			params.push(value);
			where.push(sql.replaceAll("?", `$${params.length}`));
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
		for (const [name, sql] of [["from", "w.updated_at >= ?::date"], ["to", "w.updated_at < (?::date + 1)"]] as const) {
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
		const clause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";

		const [summary, rows, users] = await Promise.all([
			this.dataSource.query(
				`SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE w.completed)::int AS finished, COUNT(DISTINCT w.user_id)::int AS users ${ACTIVITY_FROM} ${clause}`,
				params,
			) as Promise<Array<{ total: number; finished: number; users: number }>>,
			this.dataSource.query(
				`SELECT ${ACTIVITY_SELECT} ${ACTIVITY_FROM} ${clause} ORDER BY ${SORTS[sort]} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
				[...params, pageSize, (page - 1) * pageSize],
			) as Promise<ActivityRow[]>,
			this.dataSource.query(`SELECT id, COALESCE(display_name, username) AS name FROM users ORDER BY name ASC`) as Promise<Array<{ id: string; name: string }>>,
		]);

		const { total, finished, users: activeUsers } = summary[0] ?? { total: 0, finished: 0, users: 0 };
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
