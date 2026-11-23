import { randomUUID } from "node:crypto";
import { DataSource } from "typeorm";
import { describe, expect, it } from "vitest";
import { RepairPlaybackHistory1798300000029 } from "./repairPlaybackHistory1798300000029.js";

describe.skipIf(!process.env.ANALYTICS_TEST_PG_SOCKET)("playback history repair (isolated PostgreSQL)", () => {
	it("repairs an old schema, backfills legacy activity, and never restores deleted sessions", async () => {
		const source = new DataSource({
			type: "postgres",
			host: process.env.ANALYTICS_TEST_PG_SOCKET,
			port: 55441,
			username: process.env.USER,
			database: process.env.ANALYTICS_TEST_PG_DATABASE ?? "postgres",
		});
		await source.initialize();
		const runner = source.createQueryRunner();
		const schema = `history_repair_${randomUUID().replace(/-/g, "")}`;
		try {
			await runner.query(`CREATE SCHEMA "${schema}"`);
			await runner.query(`SET search_path TO "${schema}"`);
			await runner.query(`
				CREATE TABLE users (id uuid PRIMARY KEY);
				CREATE TABLE media_items (id uuid PRIMARY KEY, type text NOT NULL);
				CREATE TABLE playback_history (
					id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
					kind varchar(8) NOT NULL, item_id uuid REFERENCES media_items(id) ON DELETE SET NULL,
					channel_id text, channel_name text, watched_seconds real NOT NULL DEFAULT 0,
					started_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
				);
				CREATE TABLE viewing_sessions (id uuid PRIMARY KEY, user_id uuid, item_id uuid, channel_id text, channel_name text, watched_seconds double precision, created_at timestamptz, updated_at timestamptz);
				CREATE TABLE listening_events (user_id uuid, item_id uuid, created_at timestamptz);
				CREATE TABLE watch_progress (user_id uuid, item_id uuid, position_seconds integer, updated_at timestamptz);
				CREATE TABLE listening_history (user_id uuid, item_id uuid, played_at timestamptz);
			`);
			const user = randomUUID();
			const movie = randomUUID();
			const olderMovie = randomUUID();
			const track = randomUUID();
			const session = randomUUID();
			await runner.query("INSERT INTO users VALUES ($1)", [user]);
			await runner.query("INSERT INTO media_items VALUES ($1, 'movie'), ($2, 'movie'), ($3, 'track')", [movie, olderMovie, track]);
			await runner.query("INSERT INTO viewing_sessions VALUES ($1, $2, $3, NULL, NULL, 42, '2025-01-01', '2025-01-01')", [session, user, movie]);
			await runner.query("INSERT INTO listening_events VALUES ($1, $2, '2025-01-02')", [user, track]);
			await runner.query("INSERT INTO watch_progress VALUES ($1, $2, 42, '2025-01-01'), ($1, $3, 10, '2025-01-03')", [user, movie, olderMovie]);
			await runner.query("INSERT INTO listening_history VALUES ($1, $2, '2025-01-02')", [user, track]);
			const migration = new RepairPlaybackHistory1798300000029();
			await migration.up(runner);
			expect(await runner.query("SELECT kind, item_id FROM playback_history ORDER BY started_at")).toEqual([
				{ kind: "video", item_id: movie },
				{ kind: "music", item_id: track },
				{ kind: "video", item_id: olderMovie },
			]);
			await migration.up(runner);
			expect(await runner.query("SELECT id FROM playback_history")).toHaveLength(3);
			await runner.query("INSERT INTO playback_history_hidden_sessions VALUES ($1, $2)", [user, session]);
			await runner.query("DELETE FROM playback_history WHERE id = $1", [session]);
			await migration.up(runner);
			expect(await runner.query("SELECT id FROM playback_history WHERE id = $1", [session])).toHaveLength(0);
			await runner.query("DELETE FROM media_items WHERE id = $1", [olderMovie]);
			expect(await runner.query("SELECT id FROM playback_history WHERE item_id = $1", [olderMovie])).toHaveLength(0);
		} finally {
			await runner.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
			await runner.release();
			await source.destroy();
		}
	});
});
