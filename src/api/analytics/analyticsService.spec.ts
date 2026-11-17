import { describe, expect, it, vi } from "vitest";
import { AnalyticsController, AnalyticsReportController } from "./analyticsController.js";
import { AnalyticsService } from "./analyticsService.js";

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
		const result = await new AnalyticsService({ query } as never).snapshot();
		expect(result.video[0]).toMatchObject({ viewers: 2, completed: 1 });
		expect(result.music[0]).toMatchObject({ plays: "4", listeners: 2 });
		expect(result.orders[0]).toMatchObject({ currency: "USD", total_minor: "500" });
		expect(result.advertisements).toEqual({ total: 3, enabled: 1 });
		expect(result.adViews[0]).toMatchObject({ views: 1, skipped: 1, watched_seconds: 4 });
		expect(query.mock.calls.find(([sql]) => sql.includes("payment_orders"))?.[0]).toContain("GROUP BY currency, status");
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
		const query = vi.fn(async (sql: string, _params?: unknown[]) => {
			if (sql.includes("WITH days")) return [{ day: "2026-01-01", views: 2, watched_seconds: 12 }];
			if (sql.includes("FROM advertisements a")) return [{ id: "ad", name: "Example", views: 2 }];
			if (sql.includes("FROM advertisements")) return [{ total: 1, enabled: 1 }];
			return [];
		});
		const service = new AnalyticsService({ query } as never);
		const result = await service.snapshot(7);
		expect(result.adTrend).toEqual([{ day: "2026-01-01", views: 2, watched_seconds: 12 }]);
		expect(query.mock.calls.find(([sql]) => sql.includes("WITH days"))?.[1]).toEqual([7]);
		expect(query.mock.calls.find(([sql]) => sql.includes("FROM advertisements a"))?.[1]).toEqual([7]);
		expect(query.mock.calls.find(([sql]) => sql.includes("WITH days"))?.[0]).toContain("AT TIME ZONE 'UTC'");
		await expect(service.snapshot(365)).rejects.toThrow("Invalid advertising analytics range");
		expect(query).toHaveBeenCalledTimes(7);
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
		const query = vi.fn(async (_sql: string, _params?: unknown[]) => []);
		const service = new AnalyticsService({ query } as never);
		await service.music(7);
		await service.orders(30);
		expect(query.mock.calls).toHaveLength(3);
		expect(query.mock.calls[0]?.[1]).toEqual([7]);
		expect(query.mock.calls[2]?.[1]).toEqual([30]);
		expect(query.mock.calls[2]?.[0]).toContain("GROUP BY 1, kind, currency, status");
		await expect(service.music(0)).rejects.toThrow();
		await expect(service.orders(365)).rejects.toThrow();
		expect(query).toHaveBeenCalledTimes(3);
	});
});
