import { Inject, Injectable } from "@tsed/di";
import { BadRequest, NotFound } from "@tsed/exceptions";
import { DataSource } from "typeorm";
import { DefaultDataSource } from "../../datasources/defaultDataSource.datasource.js";
import { Advertisement } from "../../entities/advertisement.entity.js";
import { AdvertisementView, ListeningEvent, ViewingSession } from "../../entities/analytics.entity.js";
import { ListeningHistory } from "../../entities/listeningHistory.entity.js";
import { MediaItem } from "../../entities/mediaItem.entity.js";
import { PaymentOrder } from "../../entities/paymentOrder.entity.js";
import { PaymentSubscription } from "../../entities/paymentSubscription.entity.js";
import { User } from "../../entities/user.entity.js";
import { WatchProgress } from "../../entities/watchProgress.entity.js";
import { AuthService } from "../auth/authService.js";

@Injectable()
export class AnalyticsService {

	constructor(@Inject(DefaultDataSource) private readonly dataSource: DataSource) {}

	async snapshot(adDays?: number) {
		if (adDays !== undefined && ![7, 30, 90].includes(adDays)) throw new BadRequest("Invalid advertising analytics range.");
		const [video, music, orders, subscriptions, ads, adViews, adTrend] = await Promise.all([
			// RAW SQL: PostgreSQL FILTER and integer casts in aggregate expressions.
			this.dataSource
				.getRepository(WatchProgress)
				.createQueryBuilder("w")
				.innerJoin(MediaItem, "m", "m.id = w.itemId")
				.select("m.id", "id")
				.addSelect("m.title", "title")
				.addSelect("m.type", "type")
				.addSelect("count(*)::int", "viewers")
				.addSelect("count(*) FILTER (WHERE w.completed)::int", "completed")
				.addSelect("max(w.updatedAt)", "last_updated")
				.where("m.type IN (:...types)", { types: ["movie", "episode", "video"] })
				.groupBy("m.id")
				.addGroupBy("m.title")
				.addGroupBy("m.type")
				.orderBy("viewers", "DESC")
				.addOrderBy("m.title", "ASC")
				.limit(50)
				.getRawMany<{ id: string; title: string; type: string; viewers: number; completed: number; last_updated: Date }>(),
			// RAW SQL: PostgreSQL integer and bigint casts preserve aggregate result types.
			this.dataSource.getRepository(ListeningHistory).createQueryBuilder("h").innerJoin(MediaItem, "m", "m.id = h.itemId").select("m.id", "id").addSelect("m.title", "title").addSelect("sum(h.playCount)::bigint", "plays").addSelect("count(*)::int", "listeners").addSelect("max(h.playedAt)", "last_played").where("m.type = :type", { type: "track" }).groupBy("m.id").addGroupBy("m.title").orderBy("plays", "DESC").addOrderBy("m.title", "ASC").limit(50).getRawMany<{ id: string; title: string; plays: string; listeners: number; last_played: Date }>(),
			// RAW SQL: PostgreSQL bigint casts preserve monetary aggregate result types.
			this.dataSource.getRepository(PaymentOrder).createQueryBuilder("o").select("o.currency", "currency").addSelect("o.status", "status").addSelect("count(*)::int", "orders").addSelect("coalesce(sum(o.totalMinor), 0)::bigint", "total_minor").addSelect("coalesce(sum(o.refundedMinor), 0)::bigint", "refunded_minor").groupBy("o.currency").addGroupBy("o.status").orderBy("o.currency", "ASC").addOrderBy("o.status", "ASC").getRawMany<{ currency: string; status: string; orders: number; total_minor: string; refunded_minor: string }>(),
			// RAW SQL: PostgreSQL integer cast preserves the count's numeric result type.
			this.dataSource.getRepository(PaymentSubscription).createQueryBuilder("s").select("s.status", "status").addSelect("count(*)::int", "count").groupBy("s.status").orderBy("s.status", "ASC").getRawMany<{ status: string; count: number }>(),
			// RAW SQL: PostgreSQL FILTER and integer casts in aggregate expressions.
			this.dataSource.getRepository(Advertisement).createQueryBuilder("a").select("count(*)::int", "total").addSelect("count(*) FILTER (WHERE a.enabled)::int", "enabled").getRawMany<{ total: number; enabled: number }>(),
			// RAW SQL: PostgreSQL FILTER, aggregate casts and UTC date arithmetic.
			this.dataSource
				.getRepository(Advertisement)
				.createQueryBuilder("a")
				.leftJoin(AdvertisementView, "v", "v.advertisementId = a.id AND (CAST(:adDays AS integer) IS NULL OR v.createdAt >= (date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') - (CAST(:adDays AS integer) - 1) * interval '1 day')", { adDays: adDays ?? null })
				.select("a.id", "id")
				.addSelect("a.name", "name")
				.addSelect("count(v.id)::int", "views")
				.addSelect("count(v.id) FILTER (WHERE v.completed)::int", "completed")
				.addSelect("count(v.id) FILTER (WHERE v.skipped)::int", "skipped")
				.addSelect("count(v.id) FILTER (WHERE v.clicked)::int", "clicked")
				.addSelect("coalesce(sum(v.watchedSeconds), 0)::float8", "watched_seconds")
				.groupBy("a.id")
				.addGroupBy("a.name")
				.orderBy("views", "DESC")
				.addOrderBy("a.name", "ASC")
				.getRawMany<{ id: string; name: string; views: number; completed: number; skipped: number; clicked: number; watched_seconds: number }>(),
			adDays === undefined ? Promise.resolve([]) : this.advertisementTrend(adDays),
		]);
		return { video, music, orders, subscriptions, advertisements: ads[0], adViews, adTrend };
	}

	async reportAdvertisement(userId: string, raw: unknown) {
		if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new BadRequest("Invalid advertisement report.");
		const report = raw as Record<string, unknown>;
		if (typeof report.id !== "string" || !AuthService.isUuid(report.id) || typeof report.advertisementId !== "string" || !AuthService.isUuid(report.advertisementId) || typeof report.watchedSeconds !== "number" || !Number.isFinite(report.watchedSeconds) || report.watchedSeconds < 0 || typeof report.completed !== "boolean" || typeof report.skipped !== "boolean" || typeof report.clicked !== "boolean") {
			throw new BadRequest("Invalid advertisement report.");
		}
		// RAW SQL: INSERT ... SELECT with ON CONFLICT ... WHERE and RETURNING (atomic upsert-if-owned)
		const result = (await this.dataSource.query(
			`
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
		`,
			[report.id, userId, report.advertisementId, report.watchedSeconds, report.completed, report.skipped, report.clicked],
		)) as Array<{ id: string }>;
		if (!result.length) throw new NotFound("Advertisement view not found.");
	}

	async reportViewing(userId: string, raw: unknown) {
		if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new BadRequest("Invalid viewing report.");
		const report = raw as Record<string, unknown>;
		if (typeof report.id !== "string" || !AuthService.isUuid(report.id) || typeof report.watchedSeconds !== "number" || !Number.isFinite(report.watchedSeconds) || report.watchedSeconds < 0 || report.watchedSeconds > 86400 || (report.kind !== "video" && report.kind !== "live")) throw new BadRequest("Invalid viewing report.");
		const video = report.kind === "video";
		if (video ? typeof report.itemId !== "string" || !AuthService.isUuid(report.itemId) : typeof report.channelId !== "string" || report.channelId.length < 1 || report.channelId.length > 256 || typeof report.channelName !== "string" || !report.channelName.trim() || report.channelName.length > 256) {
			throw new BadRequest("Invalid viewing target.");
		}
		// RAW SQL: data-modifying CTEs with UNION ALL and ON CONFLICT ... WHERE
		const result = (await this.dataSource.query(
			`
			WITH recorded AS (
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
			RETURNING id, user_id, item_id, channel_id, channel_name, watched_seconds
			), history AS (
				INSERT INTO playback_history (id, user_id, kind, item_id, channel_id, channel_name, watched_seconds)
				SELECT id, user_id, CASE WHEN item_id IS NULL THEN 'live' ELSE 'video' END, item_id, channel_id, channel_name, watched_seconds
				FROM recorded WHERE NOT EXISTS (
					SELECT 1 FROM playback_history_hidden_sessions hidden
					WHERE hidden.user_id = recorded.user_id AND hidden.id = recorded.id
				)
				ON CONFLICT (id) DO UPDATE SET
					watched_seconds = GREATEST(playback_history.watched_seconds, EXCLUDED.watched_seconds),
					updated_at = now()
				WHERE playback_history.user_id = EXCLUDED.user_id
					AND playback_history.item_id IS NOT DISTINCT FROM EXCLUDED.item_id
					AND playback_history.channel_id IS NOT DISTINCT FROM EXCLUDED.channel_id
				RETURNING id
			)
			SELECT id FROM recorded
		`,
			[report.id, userId, video ? report.itemId : null, report.watchedSeconds, video ? null : report.channelId, video ? null : report.channelName],
		)) as Array<{ id: string }>;
		if (!result.length) throw new NotFound("Viewing session not found.");
	}

	async viewing(days: number) {
		if (![7, 30, 90].includes(days)) throw new BadRequest("Invalid viewing analytics range.");
		const where = `s.createdAt >= (date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') - (CAST(:days AS integer) - 1) * interval '1 day'`;
		const [video, live, recent, totals, daily] = await Promise.all([
			// RAW SQL: PostgreSQL UTC date arithmetic and aggregate casts.
			this.dataSource.getRepository(ViewingSession).createQueryBuilder("s").innerJoin(MediaItem, "m", "m.id = s.itemId").select("m.id", "id").addSelect("m.title", "title").addSelect("m.type", "type").addSelect("count(*)::int", "sessions").addSelect("count(DISTINCT s.userId)::int", "viewers").addSelect("sum(s.watchedSeconds)::float8", "watched_seconds").where(where, { days }).groupBy("m.id").addGroupBy("m.title").addGroupBy("m.type").orderBy("watched_seconds", "DESC").addOrderBy("m.title", "ASC").limit(50).getRawMany(),
			// RAW SQL: PostgreSQL UTC date arithmetic and aggregate casts.
			this.dataSource.getRepository(ViewingSession).createQueryBuilder("s").select("s.channelId", "id").addSelect("max(s.channelName)", "name").addSelect("count(*)::int", "sessions").addSelect("count(DISTINCT s.userId)::int", "viewers").addSelect("sum(s.watchedSeconds)::float8", "watched_seconds").where(where, { days }).andWhere("s.channelId IS NOT NULL").groupBy("s.channelId").orderBy("watched_seconds", "DESC").addOrderBy("name", "ASC").limit(50).getRawMany(),
			// RAW SQL: PostgreSQL UTC date arithmetic in the reporting window.
			this.dataSource.getRepository(ViewingSession).createQueryBuilder("s").innerJoin(User, "u", "u.id = s.userId").leftJoin(MediaItem, "m", "m.id = s.itemId").select("s.id", "id").addSelect("COALESCE(u.displayName, u.username)", "viewer").addSelect("COALESCE(m.title, s.channelName)", "title").addSelect("COALESCE(m.type, 'live')", "type").addSelect("s.watchedSeconds", "watched_seconds").addSelect("s.createdAt", "created_at").addSelect("s.updatedAt", "updated_at").where(where, { days }).orderBy("s.createdAt", "DESC").limit(50).getRawMany(),
			// RAW SQL: PostgreSQL FILTER and numeric casts in aggregate expressions.
			this.dataSource.getRepository(ViewingSession).createQueryBuilder("s").select("count(*) FILTER (WHERE s.itemId IS NOT NULL)::int", "video_sessions").addSelect("count(*) FILTER (WHERE s.channelId IS NOT NULL)::int", "live_sessions").addSelect("coalesce(sum(s.watchedSeconds), 0)::float8", "watched_seconds").where(where, { days }).getRawMany(),
			this.dailyViewingTrend(days),
		]);
		return { video, live, recent, totals: totals[0], daily };
	}

	async music(days: number) {
		if (![7, 30, 90].includes(days)) throw new BadRequest("Invalid music analytics range.");
		const [tracks, daily] = await Promise.all([
			// RAW SQL: PostgreSQL UTC date arithmetic and integer aggregate casts.
			this.dataSource.getRepository(ListeningEvent).createQueryBuilder("e").innerJoin(MediaItem, "m", "m.id = e.itemId").select("m.id", "id").addSelect("m.title", "title").addSelect("count(*)::int", "plays").addSelect("count(DISTINCT e.userId)::int", "listeners").where("e.createdAt >= (date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') - (CAST(:days AS integer) - 1) * interval '1 day'", { days }).groupBy("m.id").addGroupBy("m.title").orderBy("plays", "DESC").addOrderBy("m.title", "ASC").limit(50).getRawMany(),
			// RAW SQL: PostgreSQL UTC date arithmetic and formatting.
			this.dataSource.getRepository(ListeningEvent).createQueryBuilder("e").select("to_char(e.createdAt AT TIME ZONE 'UTC', 'YYYY-MM-DD')", "day").addSelect("count(*)::int", "plays").where("e.createdAt >= (date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') - (CAST(:days AS integer) - 1) * interval '1 day'", { days }).groupBy("day").orderBy("day", "DESC").getRawMany(),
		]);
		return { tracks, daily };
	}

	async orders(days: number) {
		if (![7, 30, 90].includes(days)) throw new BadRequest("Invalid order analytics range.");
		// RAW SQL: PostgreSQL UTC date formatting and bigint aggregate casts.
		const rows = await this.dataSource.getRepository(PaymentOrder).createQueryBuilder("o").select("to_char(o.createdAt AT TIME ZONE 'UTC', 'YYYY-MM-DD')", "day").addSelect("o.kind", "kind").addSelect("o.currency", "currency").addSelect("o.status", "status").addSelect("count(*)::int", "orders").addSelect("coalesce(sum(o.totalMinor), 0)::bigint", "total_minor").addSelect("coalesce(sum(o.refundedMinor), 0)::bigint", "refunded_minor").where("o.createdAt >= (date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') - (CAST(:days AS integer) - 1) * interval '1 day'", { days }).groupBy("day").addGroupBy("o.kind").addGroupBy("o.currency").addGroupBy("o.status").orderBy("day", "DESC").addOrderBy("o.currency", "ASC").addOrderBy("o.kind", "ASC").addOrderBy("o.status", "ASC").getRawMany();
		return { rows };
	}

	private calendarDays(days: number) {
		// RAW SQL: PostgreSQL generate_series and UTC date expressions create every calendar day in the reporting window.
		return this.dataSource.createQueryBuilder().fromDummy().select("generate_series(date_trunc('day', now() AT TIME ZONE 'UTC') - (CAST(:days AS integer) - 1) * interval '1 day', date_trunc('day', now() AT TIME ZONE 'UTC'), interval '1 day')", "day").setParameter("days", days);
	}

	private async dailyViewingTrend(days: number) {
		const totals = this.dataSource.getRepository(ViewingSession).createQueryBuilder("s").select("date_trunc('day', s.createdAt AT TIME ZONE 'UTC')", "day").addSelect("count(*) FILTER (WHERE s.itemId IS NOT NULL)::int", "video_sessions").addSelect("count(*) FILTER (WHERE s.channelId IS NOT NULL)::int", "live_sessions").addSelect("coalesce(sum(s.watchedSeconds) FILTER (WHERE s.itemId IS NOT NULL), 0)::float8", "video_seconds").addSelect("coalesce(sum(s.watchedSeconds) FILTER (WHERE s.channelId IS NOT NULL), 0)::float8", "live_seconds").where("s.createdAt >= (date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') - (CAST(:days AS integer) - 1) * interval '1 day'", { days }).groupBy("date_trunc('day', s.createdAt AT TIME ZONE 'UTC')");
		return this.dataSource.createQueryBuilder().addCommonTableExpression(this.calendarDays(days), "days").addCommonTableExpression(totals, "totals").select("to_char(days.day, 'YYYY-MM-DD')", "day").addSelect("coalesce(totals.video_sessions, 0)::int", "video_sessions").addSelect("coalesce(totals.live_sessions, 0)::int", "live_sessions").addSelect("coalesce(totals.video_seconds, 0)::float8", "video_seconds").addSelect("coalesce(totals.live_seconds, 0)::float8", "live_seconds").from("days", "days").leftJoin("totals", "totals", "totals.day = days.day").orderBy("days.day", "DESC").getRawMany();
	}

	private async advertisementTrend(days: number) {
		const totals = this.dataSource.getRepository(AdvertisementView).createQueryBuilder("view").select("date_trunc('day', view.createdAt AT TIME ZONE 'UTC')", "day").addSelect("count(*)::int", "views").addSelect("coalesce(sum(view.watchedSeconds), 0)::float8", "watched_seconds").where("view.createdAt >= (date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') - (CAST(:days AS integer) - 1) * interval '1 day'", { days }).groupBy("date_trunc('day', view.createdAt AT TIME ZONE 'UTC')");
		return this.dataSource.createQueryBuilder().addCommonTableExpression(this.calendarDays(days), "days").addCommonTableExpression(totals, "totals").select("to_char(days.day, 'YYYY-MM-DD')", "day").addSelect("coalesce(totals.views, 0)::int", "views").addSelect("coalesce(totals.watched_seconds, 0)::float8", "watched_seconds").from("days", "days").leftJoin("totals", "totals", "totals.day = days.day").orderBy("days.day", "ASC").getRawMany();
	}
}
