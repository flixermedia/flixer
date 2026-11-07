import { Inject, Injectable } from "@tsed/di";
import { BadRequest, NotFound } from "@tsed/exceptions";
import { DataSource } from "typeorm";
import { DefaultDataSource } from "../../datasources/defaultDataSource.datasource.js";
import { AuthService } from "../auth/authService.js";

@Injectable()
export class AnalyticsService {
	constructor(@Inject(DefaultDataSource) private readonly dataSource: DataSource) {}

	async snapshot(adDays?: number) {
		if (adDays !== undefined && ![7, 30, 90].includes(adDays)) throw new BadRequest("Invalid advertising analytics range.");
		const [video, music, orders, subscriptions, ads, adViews, adTrend] = await Promise.all([
			this.dataSource.query(`
				SELECT m.id, m.title, m.type, count(*)::int AS viewers,
					count(*) FILTER (WHERE w.completed)::int AS completed,
					max(w.updated_at) AS last_updated
				FROM watch_progress w JOIN media_items m ON m.id = w.item_id
				WHERE m.type IN ('movie', 'episode', 'video')
				GROUP BY m.id, m.title, m.type
				ORDER BY viewers DESC, m.title ASC LIMIT 50
			`) as Promise<Array<{ id: string; title: string; type: string; viewers: number; completed: number; last_updated: Date }>>,
			this.dataSource.query(`
				SELECT m.id, m.title, sum(h.play_count)::bigint AS plays,
					count(*)::int AS listeners, max(h.played_at) AS last_played
				FROM listening_history h JOIN media_items m ON m.id = h.item_id
				WHERE m.type = 'track'
				GROUP BY m.id, m.title ORDER BY plays DESC, m.title ASC LIMIT 50
			`) as Promise<Array<{ id: string; title: string; plays: string; listeners: number; last_played: Date }>>,
			this.dataSource.query(`
				SELECT currency, status, count(*)::int AS orders,
					coalesce(sum(total_minor), 0)::bigint AS total_minor,
					coalesce(sum(refunded_minor), 0)::bigint AS refunded_minor
				FROM payment_orders GROUP BY currency, status ORDER BY currency, status
			`) as Promise<Array<{ currency: string; status: string; orders: number; total_minor: string; refunded_minor: string }>>,
			this.dataSource.query(`
				SELECT status, count(*)::int AS count FROM payment_subscriptions
				GROUP BY status ORDER BY status
			`) as Promise<Array<{ status: string; count: number }>>,
			this.dataSource.query(`
				SELECT count(*)::int AS total, count(*) FILTER (WHERE enabled)::int AS enabled
				FROM advertisements
			`) as Promise<Array<{ total: number; enabled: number }>>,
			this.dataSource.query(`
				SELECT a.id, a.name, count(v.id)::int AS views,
					count(v.id) FILTER (WHERE v.completed)::int AS completed,
					count(v.id) FILTER (WHERE v.skipped)::int AS skipped,
					count(v.id) FILTER (WHERE v.clicked)::int AS clicked,
					coalesce(sum(v.watched_seconds), 0)::float8 AS watched_seconds
				FROM advertisements a LEFT JOIN advertisement_views v ON v.advertisement_id = a.id
					AND ($1::integer IS NULL OR v.created_at >=
						(date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') - ($1::integer - 1) * interval '1 day')
				GROUP BY a.id, a.name ORDER BY views DESC, a.name ASC
			`, [adDays ?? null]) as Promise<Array<{ id: string; name: string; views: number; completed: number; skipped: number; clicked: number; watched_seconds: number }>>,
			adDays === undefined ? Promise.resolve([]) : this.dataSource.query(`
				WITH days AS (
					SELECT generate_series(
						date_trunc('day', now() AT TIME ZONE 'UTC') - ($1::integer - 1) * interval '1 day',
						date_trunc('day', now() AT TIME ZONE 'UTC'), interval '1 day'
					) AS day
				), totals AS (
					SELECT date_trunc('day', created_at AT TIME ZONE 'UTC') AS day,
						count(*)::int AS views,
						coalesce(sum(watched_seconds), 0)::float8 AS watched_seconds
					FROM advertisement_views
					WHERE created_at >= (date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') - ($1::integer - 1) * interval '1 day'
					GROUP BY 1
				)
				SELECT to_char(days.day, 'YYYY-MM-DD') AS day,
					coalesce(totals.views, 0)::int AS views,
					coalesce(totals.watched_seconds, 0)::float8 AS watched_seconds
				FROM days LEFT JOIN totals ON totals.day = days.day ORDER BY days.day
			`, [adDays]) as Promise<Array<{ day: string; views: number; watched_seconds: number }>>,
		]);
		return { video, music, orders, subscriptions, advertisements: ads[0], adViews, adTrend };
	}

	async reportAdvertisement(userId: string, raw: unknown) {
		if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new BadRequest("Invalid advertisement report.");
		const report = raw as Record<string, unknown>;
		if (typeof report.id !== "string" || !AuthService.isUuid(report.id) ||
			typeof report.advertisementId !== "string" || !AuthService.isUuid(report.advertisementId) ||
			typeof report.watchedSeconds !== "number" || !Number.isFinite(report.watchedSeconds) || report.watchedSeconds < 0 ||
			typeof report.completed !== "boolean" || typeof report.skipped !== "boolean" || typeof report.clicked !== "boolean") {
			throw new BadRequest("Invalid advertisement report.");
		}
		const result = await this.dataSource.query(`
			INSERT INTO advertisement_views (id, user_id, advertisement_id, watched_seconds, completed, skipped, clicked)
			SELECT $1, $2, a.id, LEAST($4, a.duration_seconds), $5, $6, $7
			FROM advertisements a WHERE a.id = $3
			ON CONFLICT (id) DO UPDATE SET
				watched_seconds = GREATEST(advertisement_views.watched_seconds, EXCLUDED.watched_seconds),
				completed = advertisement_views.completed OR EXCLUDED.completed,
				skipped = advertisement_views.skipped OR EXCLUDED.skipped,
				clicked = advertisement_views.clicked OR EXCLUDED.clicked,
				updated_at = now()
			WHERE advertisement_views.user_id = EXCLUDED.user_id
				AND advertisement_views.advertisement_id = EXCLUDED.advertisement_id
			RETURNING id
		`, [report.id, userId, report.advertisementId, report.watchedSeconds, report.completed, report.skipped, report.clicked]) as Array<{ id: string }>;
		if (!result.length) throw new NotFound("Advertisement view not found.");
	}

	async reportViewing(userId: string, raw: unknown) {
		if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new BadRequest("Invalid viewing report.");
		const report = raw as Record<string, unknown>;
		if (typeof report.id !== "string" || !AuthService.isUuid(report.id) ||
			typeof report.watchedSeconds !== "number" || !Number.isFinite(report.watchedSeconds) ||
			report.watchedSeconds < 0 || report.watchedSeconds > 86400 ||
			(report.kind !== "video" && report.kind !== "live")) throw new BadRequest("Invalid viewing report.");
		const video = report.kind === "video";
		if (video ? typeof report.itemId !== "string" || !AuthService.isUuid(report.itemId) :
			typeof report.channelId !== "string" || report.channelId.length < 1 || report.channelId.length > 256 ||
			typeof report.channelName !== "string" || !report.channelName.trim() || report.channelName.length > 256) {
			throw new BadRequest("Invalid viewing target.");
		}
		const result = await this.dataSource.query(`
			INSERT INTO viewing_sessions (id, user_id, item_id, channel_id, channel_name, watched_seconds)
			SELECT $1::uuid, $2::uuid, m.id, NULL::text, NULL::text, $4::float8
			FROM media_items m WHERE $3::uuid IS NOT NULL AND m.id = $3 AND m.type IN ('movie', 'episode', 'video')
			UNION ALL
			SELECT $1::uuid, $2::uuid, NULL::uuid, $5::text, $6::text, $4::float8 WHERE $3::uuid IS NULL
			ON CONFLICT (id) DO UPDATE SET
				watched_seconds = GREATEST(viewing_sessions.watched_seconds,
					LEAST($4, 86400)),
				updated_at = now()
			WHERE viewing_sessions.user_id = EXCLUDED.user_id
				AND viewing_sessions.item_id IS NOT DISTINCT FROM EXCLUDED.item_id
				AND viewing_sessions.channel_id IS NOT DISTINCT FROM EXCLUDED.channel_id
			RETURNING id
		`, [report.id, userId, video ? report.itemId : null, report.watchedSeconds, video ? null : report.channelId, video ? null : report.channelName]) as Array<{ id: string }>;
		if (!result.length) throw new NotFound("Viewing session not found.");
	}

	async viewing(days: number) {
		if (![7, 30, 90].includes(days)) throw new BadRequest("Invalid viewing analytics range.");
		const where = `s.created_at >= (date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') - ($1::integer - 1) * interval '1 day'`;
		const [video, live, recent, totals, daily] = await Promise.all([
			this.dataSource.query(`
				SELECT m.id, m.title, m.type, count(*)::int AS sessions,
					count(DISTINCT s.user_id)::int AS viewers, sum(s.watched_seconds)::float8 AS watched_seconds
				FROM viewing_sessions s JOIN media_items m ON m.id = s.item_id
				WHERE ${where} GROUP BY m.id, m.title, m.type ORDER BY watched_seconds DESC, m.title LIMIT 50
			`, [days]),
			this.dataSource.query(`
				SELECT s.channel_id AS id, max(s.channel_name) AS name, count(*)::int AS sessions,
					count(DISTINCT s.user_id)::int AS viewers, sum(s.watched_seconds)::float8 AS watched_seconds
				FROM viewing_sessions s WHERE ${where} AND s.channel_id IS NOT NULL
				GROUP BY s.channel_id ORDER BY watched_seconds DESC, name LIMIT 50
			`, [days]),
			this.dataSource.query(`
				SELECT s.id, COALESCE(u.display_name, u.username) AS viewer,
					COALESCE(m.title, s.channel_name) AS title, COALESCE(m.type, 'live') AS type,
					s.watched_seconds, s.created_at, s.updated_at
				FROM viewing_sessions s JOIN users u ON u.id = s.user_id
				LEFT JOIN media_items m ON m.id = s.item_id
				WHERE ${where} ORDER BY s.created_at DESC LIMIT 50
			`, [days]),
			this.dataSource.query(`
				SELECT count(*) FILTER (WHERE item_id IS NOT NULL)::int AS video_sessions,
					count(*) FILTER (WHERE channel_id IS NOT NULL)::int AS live_sessions,
					coalesce(sum(watched_seconds), 0)::float8 AS watched_seconds
				FROM viewing_sessions s WHERE ${where}
			`, [days]),
			this.dataSource.query(`
				WITH days AS (
					SELECT generate_series(
						date_trunc('day', now() AT TIME ZONE 'UTC') - ($1::integer - 1) * interval '1 day',
						date_trunc('day', now() AT TIME ZONE 'UTC'), interval '1 day'
					) AS day
				), totals AS (
					SELECT date_trunc('day', s.created_at AT TIME ZONE 'UTC') AS day,
						count(*) FILTER (WHERE s.item_id IS NOT NULL)::int AS video_sessions,
						count(*) FILTER (WHERE s.channel_id IS NOT NULL)::int AS live_sessions,
						coalesce(sum(s.watched_seconds) FILTER (WHERE s.item_id IS NOT NULL), 0)::float8 AS video_seconds,
						coalesce(sum(s.watched_seconds) FILTER (WHERE s.channel_id IS NOT NULL), 0)::float8 AS live_seconds
					FROM viewing_sessions s WHERE ${where} GROUP BY 1
				)
				SELECT to_char(days.day, 'YYYY-MM-DD') AS day,
					coalesce(totals.video_sessions, 0)::int AS video_sessions,
					coalesce(totals.live_sessions, 0)::int AS live_sessions,
					coalesce(totals.video_seconds, 0)::float8 AS video_seconds,
					coalesce(totals.live_seconds, 0)::float8 AS live_seconds
				FROM days LEFT JOIN totals ON totals.day = days.day ORDER BY days.day DESC
			`, [days]),
		]);
		return { video, live, recent, totals: totals[0], daily };
	}

	async music(days: number) {
		if (![7, 30, 90].includes(days)) throw new BadRequest("Invalid music analytics range.");
		const [tracks, daily] = await Promise.all([
			this.dataSource.query(`
				SELECT m.id, m.title, count(*)::int AS plays, count(DISTINCT e.user_id)::int AS listeners
				FROM listening_events e JOIN media_items m ON m.id = e.item_id
				WHERE e.created_at >= (date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') - ($1::integer - 1) * interval '1 day'
				GROUP BY m.id, m.title ORDER BY plays DESC, m.title LIMIT 50
			`, [days]),
			this.dataSource.query(`
				SELECT to_char(e.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day, count(*)::int AS plays
				FROM listening_events e
				WHERE e.created_at >= (date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') - ($1::integer - 1) * interval '1 day'
				GROUP BY 1 ORDER BY 1 DESC
			`, [days]),
		]);
		return { tracks, daily };
	}

	async orders(days: number) {
		if (![7, 30, 90].includes(days)) throw new BadRequest("Invalid order analytics range.");
		const rows = await this.dataSource.query(`
			SELECT to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day, kind, currency, status,
				count(*)::int AS orders, coalesce(sum(total_minor), 0)::bigint AS total_minor,
				coalesce(sum(refunded_minor), 0)::bigint AS refunded_minor
			FROM payment_orders
			WHERE created_at >= (date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') - ($1::integer - 1) * interval '1 day'
			GROUP BY 1, kind, currency, status ORDER BY 1 DESC, currency, kind, status
		`, [days]);
		return { rows };
	}
}
