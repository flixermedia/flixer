import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DataSource } from "typeorm";
import { CreateMediaSourceGroups1798300000011 } from "../../migrations/createMediaSourceGroups1798300000011.js";
import { MediaSourceGroupService } from "./mediaSourceGroupService.js";

const databaseUrl = process.env.MEDIA_GROUP_TEST_DATABASE_URL;

describe.skipIf(!databaseUrl)("media source groups with PostgreSQL", () => {
	const schema = `media_group_test_${randomUUID().replaceAll("-", "")}`;
	const library = randomUUID();
	const otherLibrary = randomUUID();
	let admin: DataSource;
	let database: DataSource;
	let service: MediaSourceGroupService;

	const item = async (type = "series", libraryId = library, placeholder = false) => {
		const id = randomUUID();
		await database.query(
			"INSERT INTO media_items (id, library_id, type, is_placeholder) VALUES ($1, $2, $3, $4)",
			[id, libraryId, type, placeholder],
		);
		return id;
	};
	const groups = async () => database.query("SELECT primary_id, source_id FROM media_source_groups ORDER BY primary_id, source_id");

	beforeAll(async () => {
		admin = new DataSource({ type: "postgres", url: databaseUrl });
		await admin.initialize();
		await admin.query(`CREATE SCHEMA "${schema}"`);
		database = new DataSource({ type: "postgres", url: databaseUrl, extra: { options: `-c search_path=${schema}` } });
		await database.initialize();
		await database.query("CREATE TABLE media_items (id uuid PRIMARY KEY, library_id uuid NOT NULL, type text NOT NULL, is_placeholder boolean NOT NULL, parent_id uuid REFERENCES media_items(id) ON DELETE CASCADE)");
		await database.query("CREATE TABLE watch_progress (user_id uuid NOT NULL, item_id uuid NOT NULL REFERENCES media_items(id) ON DELETE CASCADE, completed boolean NOT NULL, PRIMARY KEY (user_id, item_id))");
		const runner = database.createQueryRunner();
		try {
			await new CreateMediaSourceGroups1798300000011().up(runner);
		} finally {
			await runner.release();
		}
		service = new MediaSourceGroupService(database);
	});

	afterAll(async () => {
		if (database?.isInitialized) await database.destroy();
		if (admin?.isInitialized) {
			await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
			await admin.destroy();
		}
	});

	it("merges and splits sources without changing or deleting their rows", async () => {
		const primary = await item();
		const first = await item();
		const second = await item();
		await service.merge(primary, first);
		await service.merge(primary, second);
		await service.merge(primary, first);
		expect(await groups()).toHaveLength(2);
		expect(await service.groupFor(first)).toEqual({ primaryId: primary, sourceIds: [first, second].sort() });
		await service.split(first);
		expect(await groups()).toEqual([{ primary_id: primary, source_id: second }]);
		expect(await service.groupFor(first)).toEqual({ primaryId: first, sourceIds: [] });
		await service.split(primary);
		expect(await groups()).toEqual([]);
		expect(await database.query("SELECT id FROM media_items WHERE id = ANY($1::uuid[])", [[primary, first, second]])).toHaveLength(3);
	});

	it("rejects incompatible sources, placeholders and overlapping groups", async () => {
		const primary = await item();
		const source = await item();
		const unrelated = await item();
		await expect(service.merge(primary, primary)).rejects.toThrow("itself");
		await expect(service.merge(primary, await item("movie"))).rejects.toThrow("same type and library");
		await expect(service.merge(primary, await item("series", otherLibrary))).rejects.toThrow("same type and library");
		await expect(service.merge(primary, await item("series", library, true))).rejects.toThrow("available");
		await service.merge(primary, source);
		await expect(service.merge(source, unrelated)).rejects.toThrow("existing group");
		await expect(service.merge(unrelated, primary)).rejects.toThrow("existing group");
		await expect(service.merge(unrelated, source)).rejects.toThrow("existing group");
		await service.split(primary);
	});

	it("serializes concurrent claims on a source", async () => {
		const primary = await item();
		const other = await item();
		const source = await item();
		const results = await Promise.allSettled([service.merge(primary, source), service.merge(other, source)]);
		expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
		expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
		await service.split(source);
	});

	it("does not form cycles when opposite merges run concurrently", async () => {
		const first = await item();
		const second = await item();
		const results = await Promise.allSettled([service.merge(first, second), service.merge(second, first)]);
		expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
		expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
		expect(await groups()).toHaveLength(1);
		await service.split(first);
	});

	it("dissolves relationships on deletion without deleting the other source", async () => {
		const primary = await item();
		const source = await item();
		await service.merge(primary, source);
		await database.query("DELETE FROM media_items WHERE id = $1", [primary]);
		expect(await groups()).toEqual([]);
		expect(await database.query("SELECT id FROM media_items WHERE id = $1", [source])).toEqual([{ id: source }]);
	});

	it("removes a deleted member without dissolving the remaining group", async () => {
		const primary = await item();
		const first = await item();
		const second = await item();
		await service.merge(primary, first);
		await service.merge(primary, second);
		await database.query("DELETE FROM media_items WHERE id = $1", [first]);
		expect(await service.groupFor(primary)).toEqual({ primaryId: primary, sourceIds: [second] });
		await service.split(primary);
	});

	it("preserves each source tree and watch progress through merge and split", async () => {
		const primary = await item();
		const source = await item();
		const firstSeason = await item("season");
		const secondSeason = await item("season");
		const firstEpisode = await item("episode");
		const secondEpisode = await item("episode");
		await database.query("UPDATE media_items SET parent_id = $1 WHERE id = $2", [primary, firstSeason]);
		await database.query("UPDATE media_items SET parent_id = $1 WHERE id = $2", [source, secondSeason]);
		await database.query("UPDATE media_items SET parent_id = $1 WHERE id = $2", [firstSeason, firstEpisode]);
		await database.query("UPDATE media_items SET parent_id = $1 WHERE id = $2", [secondSeason, secondEpisode]);
		const user = randomUUID();
		await database.query("INSERT INTO watch_progress VALUES ($1, $2, true), ($1, $3, false)", [user, firstEpisode, secondEpisode]);
		await service.merge(primary, source);
		await service.split(source);
		const descendants = await database.query("SELECT id, parent_id FROM media_items WHERE id = ANY($1::uuid[]) ORDER BY id", [[firstSeason, secondSeason, firstEpisode, secondEpisode]]);
		expect(descendants).toHaveLength(4);
		expect(descendants).toEqual(expect.arrayContaining([
			{ id: firstSeason, parent_id: primary },
			{ id: secondSeason, parent_id: source },
			{ id: firstEpisode, parent_id: firstSeason },
			{ id: secondEpisode, parent_id: secondSeason },
		]));
		expect(await database.query("SELECT item_id, completed FROM watch_progress WHERE user_id = $1 ORDER BY item_id", [user])).toEqual(expect.arrayContaining([
			{ item_id: firstEpisode, completed: true },
			{ item_id: secondEpisode, completed: false },
		]));
	});

	it("returns not found for missing sources", async () => {
		const missing = randomUUID();
		await expect(service.groupFor(missing)).rejects.toThrow("not found");
		await expect(service.split(missing)).rejects.toThrow("not found");
		await expect(service.merge(await item(), missing)).rejects.toThrow("not found");
	});
});
