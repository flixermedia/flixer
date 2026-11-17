import { randomUUID } from "node:crypto";
import { DataSource } from "typeorm";
import { describe, expect, it } from "vitest";
import { UserMediaService } from "./userMediaService.js";

describe.skipIf(!process.env.ANALYTICS_TEST_PG_SOCKET)("grouped playback history (isolated PostgreSQL)", () => {
	it("groups only adjacent sessions before pagination and removes the entire selected group", async () => {
		const source = new DataSource({
			type: "postgres",
			host: process.env.ANALYTICS_TEST_PG_SOCKET,
			port: 55441,
			username: process.env.USER,
			database: process.env.ANALYTICS_TEST_PG_DATABASE ?? "postgres",
		});
		await source.initialize();
		const runner = source.createQueryRunner();
		const schema = `history_groups_${randomUUID().replace(/-/g, "")}`;
		try {
			await runner.query(`CREATE SCHEMA "${schema}"`);
			await runner.query(`SET search_path TO "${schema}"`);
			await runner.query(`
				CREATE TABLE media_items (id uuid PRIMARY KEY, type text NOT NULL, parent_id uuid, is_placeholder boolean NOT NULL DEFAULT false);
				CREATE TABLE playback_history (
					id uuid PRIMARY KEY, user_id uuid NOT NULL, kind varchar(8) NOT NULL,
					item_id uuid, channel_id text, channel_name text, watched_seconds real NOT NULL,
					started_at timestamptz NOT NULL, updated_at timestamptz NOT NULL
				);
				CREATE TABLE playback_history_hidden_sessions (user_id uuid NOT NULL, id uuid NOT NULL, PRIMARY KEY (user_id, id));
			`);
			const user = randomUUID();
			const other = randomUUID();
			const movie = randomUUID();
			const secondMovie = randomUUID();
			const series = randomUUID();
			const season = randomUUID();
			const secondSeason = randomUUID();
			const episodes = Array.from({ length: 3 }, () => randomUUID());
			const album = randomUUID();
			const tracks = Array.from({ length: 3 }, () => randomUUID());
			await runner.query(
				`INSERT INTO media_items (id, type, parent_id) VALUES
				($1, 'movie', NULL), ($2, 'movie', NULL), ($3, 'series', NULL),
				($4, 'season', $3), ($5, 'season', $3), ($6, 'episode', $4), ($7, 'episode', $5), ($8, 'episode', $3),
				($9, 'album', NULL), ($10, 'track', $9), ($11, 'track', $9), ($12, 'track', $9)`,
				[movie, secondMovie, series, season, secondSeason, ...episodes, album, ...tracks],
			);
			const sessions = Array.from({ length: 8 }, () => randomUUID());
			const entries = [
				{ id: sessions[0], kind: "video", itemId: movie, channelId: null, name: null, seconds: 10 },
				{ id: sessions[1], kind: "video", itemId: movie, channelId: null, name: null, seconds: 20 },
				{ id: sessions[2], kind: "video", itemId: secondMovie, channelId: null, name: null, seconds: 30 },
				{ id: sessions[3], kind: "video", itemId: movie, channelId: null, name: null, seconds: 40 },
				{ id: sessions[4], kind: "video", itemId: movie, channelId: null, name: null, seconds: 50 },
				{ id: sessions[5], kind: "live", itemId: null, channelId: "news", name: "News", seconds: 60 },
				{ id: sessions[6], kind: "live", itemId: null, channelId: "news", name: "Old News", seconds: 70 },
				{ id: sessions[7], kind: "live", itemId: null, channelId: "sport", name: "Sport", seconds: 80 },
			];
			for (const [index, entry] of entries.entries()) {
				const at = new Date(Date.UTC(2025, 0, 1, 12, 0, 0) - index * 10_000);
				await runner.query("INSERT INTO playback_history VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)", [entry.id, user, entry.kind, entry.itemId, entry.channelId, entry.name, entry.seconds, at]);
			}
			await runner.query("INSERT INTO playback_history VALUES ($1, $2, 'video', $3, NULL, NULL, 1, $4, $4)", [randomUUID(), other, secondMovie, new Date(Date.UTC(2025, 0, 1, 11, 59, 55))]);
			const card = (id: string, title: string, type = "movie") => ({ id, title, type, year: 2025, images: [], metadata: {}, parentId: null, updatedAt: new Date() });
			const dataSource = {
				query: (sql: string, parameters: unknown[]) => runner.query(sql, parameters),
				getRepository: () => ({ find: async () => [card(movie, "First"), card(secondMovie, "Second"), card(series, "Series", "series"), card(album, "Album", "album")] }),
			} as unknown as DataSource;
			const service = new UserMediaService(dataSource, {} as never);
			const firstPage = await service.history(user, 0, 2);
			expect(firstPage.map((entry) => [entry.id, entry.item?.id, entry.watchedSeconds])).toEqual([
				[sessions[0], movie, 30],
				[sessions[2], secondMovie, 30],
			]);
			const secondPage = await service.history(user, 2, 2);
			expect(secondPage.map((entry) => [entry.id, entry.item?.id ?? entry.channelName, entry.watchedSeconds])).toEqual([
				[sessions[3], movie, 90],
				[sessions[5], "News", 130],
			]);
			expect((await service.history(user, 4, 2)).map((entry) => entry.channelName)).toEqual(["Sport"]);
			await service.removeHistory(other, sessions[0]);
			expect(await runner.query("SELECT id FROM playback_history WHERE id = $1", [sessions[0]])).toHaveLength(1);
			await service.removeHistory(user, sessions[0]);
			expect(await runner.query("SELECT id FROM playback_history WHERE id = ANY($1::uuid[])", [[sessions[0], sessions[1]]])).toHaveLength(0);
			expect(await runner.query("SELECT id FROM playback_history WHERE id = ANY($1::uuid[])", [[sessions[3], sessions[4]]])).toHaveLength(2);
			expect(await runner.query("SELECT id FROM playback_history_hidden_sessions WHERE user_id = $1", [user])).toHaveLength(2);

			const groupedUser = randomUUID();
			const groupedSessions = Array.from({ length: 8 }, () => randomUUID());
			const groupedItems = [episodes[1], episodes[0], movie, episodes[2], tracks[1], tracks[0], movie, tracks[2]];
			for (const [index, itemId] of groupedItems.entries()) {
				const at = new Date(Date.UTC(2025, 0, 2, 12, 0, 0) - index * 10_000);
				const kind = index === 4 || index === 5 || index === 7 ? "music" : "video";
				await runner.query("INSERT INTO playback_history VALUES ($1, $2, $3, $4, NULL, NULL, 10, $5, $5)", [groupedSessions[index], groupedUser, kind, itemId, at]);
			}
			const grouped = await service.history(groupedUser, 0, 20);
			expect(grouped.map((entry) => [entry.item?.id, entry.item?.type])).toEqual([
				[series, "series"],
				[movie, "movie"],
				[series, "series"],
				[album, "album"],
				[movie, "movie"],
				[album, "album"],
			]);
			expect(grouped[0].sourceItemIds).toEqual(expect.arrayContaining([episodes[0], episodes[1]]));
			expect(grouped[3].sourceItemIds).toEqual(expect.arrayContaining([tracks[0], tracks[1]]));
			await service.removeHistory(groupedUser, groupedSessions[0]);
			await service.removeHistory(groupedUser, groupedSessions[4]);
			expect(await runner.query("SELECT id FROM playback_history WHERE id = ANY($1::uuid[])", [[groupedSessions[0], groupedSessions[1], groupedSessions[4], groupedSessions[5]]])).toHaveLength(0);
			expect(await runner.query("SELECT id FROM playback_history WHERE id = ANY($1::uuid[])", [[groupedSessions[3], groupedSessions[7]]])).toHaveLength(2);
		} finally {
			await runner.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
			await runner.release();
			await source.destroy();
		}
	});
});
