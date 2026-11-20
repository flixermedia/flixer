import { createHash, randomUUID } from "node:crypto";
import { DataSource } from "typeorm";
import { ENTITIES } from "../../datasources/entityList.js";
import { describe, expect, it } from "vitest";
import { AutomaticCollectionsService } from "./automaticCollectionsService.js";
import { UserMediaService } from "./userMediaService.js";
import { VideoCollection, VideoCollectionItem } from "../../entities/videoCollection.entity.js";

describe.skipIf(!process.env.ANALYTICS_TEST_PG_SOCKET)("automatic collections (isolated PostgreSQL)", () => {
	it("groups metadata case-insensitively and only counts or returns permitted movies", async () => {
		const source = new DataSource({
			type: "postgres",
			host: process.env.ANALYTICS_TEST_PG_SOCKET,
			port: 55441,
			username: process.env.USER,
			database: process.env.ANALYTICS_TEST_PG_DATABASE ?? "postgres",
			entities: ENTITIES,
		});
		await source.initialize();
		const runner = source.createQueryRunner();
		const schema = `automatic_collections_${randomUUID().replace(/-/g, "")}`;
		try {
			await runner.query(`CREATE SCHEMA "${schema}"`);
			await runner.query(`SET search_path TO "${schema}"`);
			await runner.query("CREATE TABLE media_items (id uuid PRIMARY KEY, type text, metadata jsonb, year int, sort_title text, is_placeholder boolean NOT NULL DEFAULT false)");
			await runner.query("CREATE TABLE video_collections (id uuid PRIMARY KEY, user_id uuid NOT NULL, name text NOT NULL, description text, is_public boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now())");
			await runner.query("CREATE TABLE video_collection_items (collection_id uuid NOT NULL, item_id uuid NOT NULL, position int NOT NULL)");
			const first = randomUUID();
			const second = randomUUID();
			const restricted = randomUUID();
			const other = randomUUID();
			await runner.query(
				`INSERT INTO media_items (id, type, metadata, year, sort_title) VALUES
				($1, 'movie', $5, 2002, 'Second'), ($2, 'movie', $6, 1999, 'First'),
				($3, 'movie', $5, 2003, 'Restricted'), ($4, 'movie', $7, 2020, 'Other')`,
				[first, second, restricted, other, { collection: "Example Collection" }, { collection: "  example collection  " }, { collection: "Other Collection" }],
			);
			const updatedAt = new Date("2025-01-01T00:00:00Z");
			const card = (id: string, title: string) => ({ id, title, type: "movie", year: 2020, images: [{ type: "poster", path: "poster.jpg" }], metadata: {}, parentId: null, updatedAt });
			const dataSource = {
				query: (sql: string, parameters: unknown[]) => runner.query(sql, parameters),
				getRepository: (entity: unknown) => ({
					createQueryBuilder: (alias: string) => source.createQueryBuilder(runner).from(entity === VideoCollection ? VideoCollection : "media_items", alias),
					find: async () => [card(first, "Second"), card(second, "First"), card(other, "Other")],
				}),
			} as unknown as DataSource;
			const access = { restrict: (query: { andWhere: (sql: string, params: object) => unknown }) => query.andWhere("item.id <> :restricted", { restricted }) };
			const service = new AutomaticCollectionsService(dataSource, access as never);
			const id = createHash("sha256").update("example collection").digest("hex");
			const groups = await service.list({ userId: "user" } as never);
			expect(groups).toEqual(expect.arrayContaining([expect.objectContaining({ id, itemCount: 2, cover: { itemId: second, index: 0, version: updatedAt } })]));
			expect(groups).toHaveLength(1);
			const detail = await service.get({ userId: "user" } as never, id);
			expect(detail.items.map((item) => item.id)).toEqual([second, first]);
			expect(detail.itemCount).toBe(2);
			const owner = randomUUID();
			const collectionId = randomUUID();
			await runner.query("INSERT INTO video_collections (id, user_id, name) VALUES ($1, $2, 'Custom')", [collectionId, owner]);
			await runner.query("INSERT INTO video_collection_items VALUES ($1, $2, 0), ($1, $3, 1)", [collectionId, restricted, second]);
			const custom = await new UserMediaService(dataSource, access as never).collections(owner, { userId: owner } as never);
			expect(custom).toEqual([expect.objectContaining({ id: collectionId, itemCount: 2, visibleItemCount: 1, cover: { itemId: second, index: 0, version: updatedAt } })]);
		} finally {
			await runner.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
			await runner.release();
			await source.destroy();
		}
	});
});
