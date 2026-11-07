import { describe, expect, it } from "vitest";
import { DataSource } from "typeorm";
import { CreateViewingAnalytics1798300000007 } from "../../migrations/createViewingAnalytics1798300000007.js";
import { CreateListeningAnalytics1798300000008 } from "../../migrations/createListeningAnalytics1798300000008.js";
import { AnalyticsService } from "./analyticsService.js";

describe.skipIf(!process.env.ANALYTICS_TEST_PG_SOCKET)("analytics (isolated PostgreSQL)", () => {
	it("migrates, stores idempotent and user-bound reports, aggregates and rolls back", async () => {
		const source = new DataSource({
			type: "postgres", host: process.env.ANALYTICS_TEST_PG_SOCKET, port: 55441,
			username: process.env.USER, database: "postgres",
		});
		await source.initialize();
		const runner = source.createQueryRunner();
		const viewing = new CreateViewingAnalytics1798300000007();
		const listening = new CreateListeningAnalytics1798300000008();
		try {
			await runner.query("CREATE TABLE users (id uuid PRIMARY KEY, username text, display_name text)");
			await runner.query("CREATE TABLE media_items (id uuid PRIMARY KEY, title text, type text)");
			await viewing.up(runner);
			await listening.up(runner);
			const user = "d3929747-385b-4245-a8d2-682c37626192";
			const other = "e3929747-385b-4245-a8d2-682c37626192";
			const item = "a89c26d2-513c-4528-9d8b-7ca16004bf72";
			const id = "b89c26d2-513c-4528-9d8b-7ca16004bf72";
			const liveId = "c89c26d2-513c-4528-9d8b-7ca16004bf72";
			await runner.query("INSERT INTO users VALUES ($1, 'user', NULL), ($2, 'other', NULL)", [user, other]);
			await runner.query("INSERT INTO media_items VALUES ($1, 'Movie', 'movie')", [item]);
			const service = new AnalyticsService(source);
			await service.reportViewing(user, { id, kind: "video", itemId: item, watchedSeconds: 30 });
			await service.reportViewing(user, { id, kind: "video", itemId: item, watchedSeconds: 4 });
			await expect(service.reportViewing(other, { id, kind: "video", itemId: item, watchedSeconds: 40 })).rejects.toThrow("not found");
			await service.reportViewing(user, { id: liveId, kind: "live", channelId: "channel", channelName: "News", watchedSeconds: 12 });
			const result = await service.viewing(7);
			expect(result.video[0]).toMatchObject({ title: "Movie", sessions: 1, viewers: 1, watched_seconds: 30 });
			expect(result.live[0]).toMatchObject({ name: "News", sessions: 1, watched_seconds: 12 });
			expect(result.recent).toHaveLength(2);
			expect(result.totals).toMatchObject({ video_sessions: 1, live_sessions: 1, watched_seconds: 42 });
			expect(result.daily).toHaveLength(7);
			expect(result.daily[0]).toMatchObject({ video_sessions: 1, live_sessions: 1, video_seconds: 30, live_seconds: 12 });
			await runner.query("INSERT INTO listening_events (user_id, item_id) VALUES ($1, $2)", [user, item]);
			expect((await service.music(7)).tracks[0]).toMatchObject({ title: "Movie", plays: 1 });
			await runner.query("DELETE FROM users WHERE id = $1", [user]);
			expect(await runner.query("SELECT id FROM viewing_sessions")).toHaveLength(0);
			expect(await runner.query("SELECT id FROM listening_events")).toHaveLength(0);
			await listening.down(runner);
			await viewing.down(runner);
			expect((await runner.query("SELECT to_regclass('viewing_sessions') AS name"))[0].name).toBeNull();
		} finally {
			await runner.release();
			await source.destroy();
		}
	});
});
