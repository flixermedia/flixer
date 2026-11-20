import { describe, expect, it, vi } from "vitest";
import { AnalyticsController, AnalyticsReportController } from "./analyticsController.js";
import { AnalyticsService } from "./analyticsService.js";
import { Advertisement } from "../../entities/advertisement.entity.js";
import { AdvertisementView } from "../../entities/analytics.entity.js";
import { ListeningEvent } from "../../entities/analytics.entity.js";
import { ListeningHistory } from "../../entities/listeningHistory.entity.js";
import { PaymentOrder } from "../../entities/paymentOrder.entity.js";
import { PaymentSubscription } from "../../entities/paymentSubscription.entity.js";
import { WatchProgress } from "../../entities/watchProgress.entity.js";

function videoBuilder(rows: unknown[] = []) {

	const builder = { innerJoin: vi.fn(), leftJoin: vi.fn(), select: vi.fn(), addSelect: vi.fn(), where: vi.fn(), groupBy: vi.fn(), addGroupBy: vi.fn(), orderBy: vi.fn(), addOrderBy: vi.fn(), limit: vi.fn(), getRawMany: vi.fn().mockResolvedValue(rows) };
	for (const method of ["innerJoin", "leftJoin", "select", "addSelect", "where", "groupBy", "addGroupBy", "orderBy", "addOrderBy", "limit"] as const) builder[method].mockReturnValue(builder);
	return builder;

}

function snapshotRepositories() {

	const builders = new Map<unknown, ReturnType<typeof videoBuilder>>([
		[WatchProgress, videoBuilder([{ id: "m", title: "Movie", type: "movie", viewers: 2, completed: 1 }])],
		[ListeningHistory, videoBuilder([{ id: "t", title: "Track", plays: "4", listeners: 2 }])],
		[ListeningEvent, videoBuilder()],
		[PaymentOrder, videoBuilder([{ currency: "USD", status: "paid", orders: 1, total_minor: "500", refunded_minor: "0" }])],
		[PaymentSubscription, videoBuilder([{ status: "active", count: 1 }])],
		[Advertisement, videoBuilder([{ total: 3, enabled: 1 }])],
		[AdvertisementView, videoBuilder()],
	]);
	const adViews = videoBuilder([{ id: "ad", name: "Example", views: 1, completed: 0, skipped: 1, clicked: 0, watched_seconds: 4 }]);
	let advertisementCalls = 0;
	return { builders, adViews, getRepository: (entity: unknown) => ({ createQueryBuilder: () => (entity === Advertisement && advertisementCalls++ > 0 ? adViews : builders.get(entity)) }) };

}

describe("admin analytics", () => {
	it("requires an admin before querying analytics", async () => {
		const auth = { requireAdmin: vi.fn().mockRejectedValue(new Error("forbidden")) };
		const analytics = { snapshot: vi.fn() };
		const controller = new AnalyticsController(auth as never, analytics as never);
		await expect(controller.snapshot("Bearer user")).rejects.toThrow("forbidden");
		expect(analytics.snapshot).not.toHaveBeenCalled();
	});

	it("reports snapshots without conflating progress, play counts, or currencies", async () => {
		const query = vi.fn(async (sql: string) => {
			if (sql.includes("watch_progress")) return [{ id: "m", title: "Movie", type: "movie", viewers: 2, completed: 1 }];
			if (sql.includes("listening_history")) return [{ id: "t", title: "Track", plays: "4", listeners: 2 }];
			if (sql.includes("payment_orders")) return [{ currency: "USD", status: "paid", orders: 1, total_minor: "500", refunded_minor: "0" }];
			if (sql.includes("payment_subscriptions")) return [{ status: "active", count: 1 }];
			if (sql.includes("advertisement_views")) return [{ id: "ad", name: "Example", views: 1, completed: 0, skipped: 1, clicked: 0, watched_seconds: 4 }];
			return [{ total: 3, enabled: 1 }];
		});
		const { builders, getRepository } = snapshotRepositories();
		const builder = builders.get(WatchProgress)!;
		const result = await new AnalyticsService({ query, getRepository } as never).snapshot();
		expect(result.video[0]).toMatchObject({ viewers: 2, completed: 1 });
		expect(builder.where).toHaveBeenCalledWith("m.type IN (:...types)", { types: ["movie", "episode", "video"] });
		expect(builder.limit).toHaveBeenCalledWith(50);
		expect(result.music[0]).toMatchObject({ plays: "4", listeners: 2 });
		expect(result.orders[0]).toMatchObject({ currency: "USD", total_minor: "500" });
		expect(result.advertisements).toEqual({ total: 3, enabled: 1 });
		expect(result.adViews[0]).toMatchObject({ views: 1, skipped: 1, watched_seconds: 4 });
		expect(builders.get(PaymentOrder)?.groupBy).toHaveBeenCalledWith("o.currency");
		expect(builders.get(PaymentOrder)?.addGroupBy).toHaveBeenCalledWith("o.status");
	});

	it("validates and idempotently merges user-bound ad reports", async () => {
		const query = vi.fn().mockResolvedValue([{ id: "ok" }]);
		const service = new AnalyticsService({ query } as never);
		const report = { id: "d3929747-385b-4245-a8d2-682c37626192", advertisementId: "a89c26d2-513c-4528-9d8b-7ca16004bf72", watchedSeconds: 4, completed: false, skipped: true, clicked: false };
		await service.reportAdvertisement("user", report);
		expect(query.mock.calls[0]?.[0]).toContain("advertisement_views.user_id = EXCLUDED.user_id");
		expect(query.mock.calls[0]?.[0]).toContain("GREATEST(advertisement_views.watched_seconds");
		expect(query.mock.calls[0]?.[1]).toEqual([report.id, "user", report.advertisementId, 4, false, true, false]);
		await expect(service.reportAdvertisement("user", { ...report, watchedSeconds: -1 })).rejects.toThrow();
		expect(query).toHaveBeenCalledTimes(1);
	});

	it("bounds advertising reports to supported UTC calendar periods", async () => {
		const daysBuilder = { fromDummy: vi.fn().mockReturnThis(), select: vi.fn().mockReturnThis(), setParameter: vi.fn().mockReturnThis() };
		const trendBuilder = { addCommonTableExpression: vi.fn().mockReturnThis(), select: vi.fn().mockReturnThis(), addSelect: vi.fn().mockReturnThis(), from: vi.fn().mockReturnThis(), leftJoin: vi.fn().mockReturnThis(), orderBy: vi.fn().mockReturnThis(), getRawMany: vi.fn().mockResolvedValue([{ day: "2026-01-01", views: 2, watched_seconds: 12 }]) };
		const repositories = snapshotRepositories();
		const createQueryBuilder = vi.fn().mockReturnValueOnce(trendBuilder).mockReturnValueOnce(daysBuilder);
		const service = new AnalyticsService({ ...repositories, createQueryBuilder } as never);
		const result = await service.snapshot(7);
		expect(result.adTrend).toEqual([{ day: "2026-01-01", views: 2, watched_seconds: 12 }]);
		expect(daysBuilder.select.mock.calls[0]?.[0]).toContain("generate_series");
		expect(daysBuilder.setParameter).toHaveBeenCalledWith("days", 7);
		expect(repositories.adViews.leftJoin).toHaveBeenCalledWith(expect.anything(), "v", expect.stringContaining("AT TIME ZONE 'UTC'"), { adDays: 7 });
		expect(trendBuilder.addCommonTableExpression).toHaveBeenCalledTimes(2);
		await expect(service.snapshot(365)).rejects.toThrow("Invalid advertising analytics range");
		expect(createQueryBuilder).toHaveBeenCalledTimes(2);
	});

	it("rejects unsupported range values after authorizing the admin", async () => {
		const auth = { requireAdmin: vi.fn().mockResolvedValue(undefined) };
		const analytics = { snapshot: vi.fn() };
		const controller = new AnalyticsController(auth as never, analytics as never);
		await expect(controller.snapshot("token", "30.0")).rejects.toThrow("Invalid advertising analytics range");
		expect(analytics.snapshot).not.toHaveBeenCalled();
		await controller.snapshot("token", "90");
		expect(analytics.snapshot).toHaveBeenCalledWith(90);
	});

	it("requires an authenticated user and binds viewing reports to that user", async () => {
		const auth = { getAuthenticatedUser: vi.fn().mockResolvedValue({ id: "viewer" }) };
		const analytics = { reportViewing: vi.fn() };
		const controller = new AnalyticsReportController(auth as never, analytics as never);
		const body = { kind: "live" };
		await controller.viewing(body, "token");
		expect(analytics.reportViewing).toHaveBeenCalledWith("viewer", body);
	});

	it("validates viewing targets and merges out-of-order reports without crossing users", async () => {
		const query = vi.fn().mockResolvedValue([{ id: "ok" }]);
		const service = new AnalyticsService({ query } as never);
		const id = "d3929747-385b-4245-a8d2-682c37626192";
		const itemId = "a89c26d2-513c-4528-9d8b-7ca16004bf72";
		await service.reportViewing("user", { id, kind: "video", itemId, watchedSeconds: 8 });
		expect(query.mock.calls[0]?.[0]).toContain("viewing_sessions.user_id = EXCLUDED.user_id");
		expect(query.mock.calls[0]?.[0]).toContain("GREATEST(viewing_sessions.watched_seconds");
		expect(query.mock.calls[0]?.[1]).toEqual([id, "user", itemId, 8, null, null]);
		await service.reportViewing("user", { id, kind: "live", channelId: "channel", channelName: "News", watchedSeconds: 1 });
		expect(query.mock.calls[1]?.[1]).toEqual([id, "user", null, 1, "channel", "News"]);
		await expect(service.reportViewing("user", { id, kind: "live", channelId: "", channelName: "News", watchedSeconds: 0 })).rejects.toThrow();
		await expect(service.reportViewing("user", { id, kind: "video", itemId, watchedSeconds: Infinity })).rejects.toThrow();
		expect(query).toHaveBeenCalledTimes(2);
	});

	it("bounds music and order trends and keeps financial dimensions separate", async () => {
		const { builders, getRepository } = snapshotRepositories();
		const service = new AnalyticsService({ getRepository } as never);
		await service.music(7);
		await service.orders(30);
		expect(builders.get(ListeningEvent)?.where).toHaveBeenCalledTimes(2);
		expect(builders.get(ListeningEvent)?.where).toHaveBeenCalledWith(expect.stringContaining("AT TIME ZONE 'UTC'"), { days: 7 });
		expect(builders.get(PaymentOrder)?.where).toHaveBeenCalledWith(expect.stringContaining("AT TIME ZONE 'UTC'"), { days: 30 });
		expect(builders.get(PaymentOrder)?.addGroupBy).toHaveBeenCalledWith("o.currency");
		expect(builders.get(PaymentOrder)?.addGroupBy).toHaveBeenCalledWith("o.kind");
		expect(builders.get(PaymentOrder)?.addGroupBy).toHaveBeenCalledWith("o.status");
		await expect(service.music(0)).rejects.toThrow();
		await expect(service.orders(365)).rejects.toThrow();
		expect(builders.get(ListeningEvent)?.where).toHaveBeenCalledTimes(2);
	});
});
