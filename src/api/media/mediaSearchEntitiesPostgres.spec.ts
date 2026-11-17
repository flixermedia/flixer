// Runs the converted media search calls (lyrics, outbox) against a migrated throwaway schema:
//   ENTITY_SCHEMA_TEST_DATABASE_URL=postgres://... npx vitest run src/api/media/mediaSearchEntitiesPostgres.spec.ts
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { DataSource } from "typeorm";
import { ENTITIES } from "../../datasources/entityList.js";
import { MIGRATIONS } from "../../datasources/migrationList.js";
import { MediaItem } from "../../entities/mediaItem.entity.js";
import { MediaLibrary } from "../../entities/mediaLibrary.entity.js";
import { MediaSearchLyrics, MediaSearchOutboxEvent } from "../../entities/mediaSearch.entity.js";
import { Setting } from "../../entities/setting.entity.js";
import { MEDIA_SEARCH_ENABLED_SETTING, MediaSearchService } from "./mediaSearchService.js";

const databaseUrl = process.env.ENTITY_SCHEMA_TEST_DATABASE_URL;

describe.skipIf(!databaseUrl)("media search entities with PostgreSQL", () => {
	const schema = `media_search_entities_test_${randomUUID().replaceAll("-", "")}`;
	const library = randomUUID();
	const track = randomUUID();
	let admin: DataSource;
	let db: DataSource;
	let service: MediaSearchService;

	const outbox = () => db.getRepository(MediaSearchOutboxEvent);

	beforeAll(async () => {
		admin = new DataSource({ type: "postgres", url: databaseUrl });
		await admin.initialize();
		await admin.query(`CREATE SCHEMA "${schema}"`);
		db = new DataSource({ type: "postgres", url: databaseUrl, extra: { options: `-c search_path=${schema}` }, schema, entities: ENTITIES, migrations: MIGRATIONS, synchronize: false });
		await db.initialize();
		await db.runMigrations();
		await db.getRepository(MediaLibrary).save({ id: library, name: "Library", type: "mixed" });
		await db.getRepository(MediaItem).save({ id: track, libraryId: library, path: "/track", type: "track", title: "Track", externalKey: "track" });
		service = new MediaSearchService(db);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.unstubAllEnvs();
	});

	afterAll(async () => {
		if (db?.isInitialized) await db.destroy();
		if (admin?.isInitialized) {
			await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
			await admin.destroy();
		}
	});

	it("stores, replaces and clears lyrics and queues the track each time", async () => {
		const queued = () => outbox().countBy({ itemId: track, operation: "upsert" });
		const before = await queued();
		await service.storeTrackLyrics(track, "first words");
		const first = await db.getRepository(MediaSearchLyrics).findOneByOrFail({ itemId: track });
		expect(first.lyrics).toBe("first words");
		expect(await queued()).toBe(before + 1);

		await service.storeTrackLyrics(track, "second words");
		const second = await db.getRepository(MediaSearchLyrics).findOneByOrFail({ itemId: track });
		expect(second.lyrics).toBe("second words");
		expect(second.updatedAt.getTime()).toBeGreaterThanOrEqual(first.updatedAt.getTime());
		expect(await queued()).toBe(before + 2);

		const documents = await (service as unknown as { searchDocumentsFor: (ids: string[]) => Promise<Array<{ id: string; lyrics?: string }>> }).searchDocumentsFor([track]);
		expect(documents.find((document) => document.id === track)).toMatchObject({ lyrics: "second words" });

		await service.storeTrackLyrics(track, "   ");
		expect(await db.getRepository(MediaSearchLyrics).countBy({ itemId: track })).toBe(0);
		expect(await queued()).toBe(before + 3);
		await expect(service.storeTrackLyrics(randomUUID(), "x")).rejects.toThrow("Track not found");
	});

	it("drains processed outbox events and keeps one pending rebuild or reset", async () => {
		await db.getRepository(Setting).save({ key: MEDIA_SEARCH_ENABLED_SETTING, value: true, isPublic: false });
		vi.stubEnv("MEILISEARCH_URL", "http://meili.test");
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response(JSON.stringify({ uid: "media", numberOfDocuments: 1, results: [] }), { status: 200, headers: { "Content-Type": "application/json" } })),
		);
		expect(await outbox().count()).toBeGreaterThan(0);
		await (service as unknown as { processOutbox: () => Promise<void> }).processOutbox();
		expect(await outbox().count()).toBe(0);

		expect(await service.enqueueRebuild()).toEqual({ queued: true });
		expect(await service.enqueueRebuild()).toEqual({ queued: false });
		expect(await service.resetAndRebuild()).toEqual({ queued: true });
		expect(await service.resetAndRebuild()).toEqual({ queued: false });
		expect((await outbox().find({ order: { eventId: "ASC" } })).map((event) => event.operation)).toEqual(["rebuild", "reset"]);
	});
});
