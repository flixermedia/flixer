// PostgreSQL RLS integration test. Run with:
//   ENTITY_SCHEMA_TEST_DATABASE_URL=postgres://... npx vitest run src/datasources/rlsContext.postgres.spec.ts
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DataSource } from "typeorm";
import { Favorite } from "../entities/favorite.entity.js";
import { Playlist } from "../entities/playlist.entity.js";
import { Setting } from "../entities/setting.entity.js";
import { User } from "../entities/user.entity.js";
import { ENTITIES } from "./entityList.js";
import { MIGRATIONS } from "./migrationList.js";
import { rlsRepo, runWithRlsTransaction } from "./rlsContext.js";

const databaseUrl = process.env.ENTITY_SCHEMA_TEST_DATABASE_URL;

describe.skipIf(!databaseUrl)("PostgreSQL Row-Level Security", () => {
	let dataSource: DataSource;
	const userA = randomUUID();
	const userB = randomUUID();
	const itemA = randomUUID();
	const itemB = randomUUID();
	const publicPlaylistId = randomUUID();
	const privatePlaylistId = randomUUID();
	const settingKey = `rls_test_${userA.slice(0, 8)}`;

	beforeAll(async () => {
		dataSource = new DataSource({
			type: "postgres",
			url: databaseUrl,
			entities: ENTITIES,
			migrations: MIGRATIONS,
			synchronize: false,
			migrationsRun: false,
		});
		await dataSource.initialize();
		await dataSource.runMigrations();

		const users = dataSource.getRepository(User);
		await users.insert([
			{ id: userA, username: `rls-a-${userA.slice(0, 8)}`, passwordHash: "hash", role: "user" },
			{ id: userB, username: `rls-b-${userB.slice(0, 8)}`, passwordHash: "hash", role: "user" },
		]);
		const favorites = dataSource.getRepository(Favorite);
		await favorites.insert([
			{ userId: userA, itemId: itemA },
			{ userId: userB, itemId: itemB },
		]);
		await dataSource.getRepository(Playlist).insert([
			{ id: publicPlaylistId, userId: userA, name: "Public", isPublic: true },
			{ id: privatePlaylistId, userId: userA, name: "Private", isPublic: false },
		]);
		await dataSource.getRepository(Setting).insert({ key: settingKey, value: "secret" });
	});

	afterAll(async () => {
		if (dataSource?.isInitialized) {
			await dataSource.getRepository(Setting).delete({ key: settingKey });
			await dataSource.getRepository(Playlist).delete({ id: publicPlaylistId });
			await dataSource.getRepository(Playlist).delete({ id: privatePlaylistId });
			await dataSource.getRepository(Favorite).delete({ userId: userA });
			await dataSource.getRepository(Favorite).delete({ userId: userB });
			await dataSource.getRepository(User).delete({ id: userA });
			await dataSource.getRepository(User).delete({ id: userB });
			await dataSource.destroy();
		}
	});

	it("isolates favorites per user under flixer_app", async () => {
		const rowsA = await runWithRlsTransaction(dataSource, { userId: userA, role: "user" }, () =>
			rlsRepo(dataSource, Favorite).find(),
		);
		expect(rowsA.map((r) => r.itemId)).toEqual([itemA]);

		const rowsB = await runWithRlsTransaction(dataSource, { userId: userB, role: "user" }, () =>
			rlsRepo(dataSource, Favorite).find(),
		);
		expect(rowsB.map((r) => r.itemId)).toEqual([itemB]);
	});

	it("blocks inserting a row for another user under flixer_app", async () => {
		await expect(
			runWithRlsTransaction(dataSource, { userId: userA, role: "user" }, () =>
				rlsRepo(dataSource, Favorite).insert({ userId: userB, itemId: randomUUID() }),
			),
		).rejects.toThrow();
	});

	it("returns zero rows when unauthenticated under flixer_app", async () => {
		const rows = await runWithRlsTransaction(dataSource, {}, () => rlsRepo(dataSource, Favorite).find());
		expect(rows).toEqual([]);
	});

	it("enforces visibility on playlists and blocks non-owner updates", async () => {
		const visibleToB = await runWithRlsTransaction(dataSource, { userId: userB, role: "user" }, () =>
			rlsRepo(dataSource, Playlist).findBy({ userId: userA }),
		);
		expect(visibleToB.map((p) => p.id)).toEqual([publicPlaylistId]);

		const updateAttempt = await runWithRlsTransaction(dataSource, { userId: userB, role: "user" }, () =>
			rlsRepo(dataSource, Playlist).update({ id: publicPlaylistId }, { name: "Hacked" }),
		);
		expect(updateAttempt.affected).toBe(0);
	});

	it("restricts admin-only settings to admin role", async () => {
		const userRows = await runWithRlsTransaction(dataSource, { userId: userA, role: "user" }, () =>
			rlsRepo(dataSource, Setting).findBy({ key: settingKey }),
		);
		expect(userRows).toEqual([]);

		const adminRows = await runWithRlsTransaction(dataSource, { userId: userA, role: "admin" }, () =>
			rlsRepo(dataSource, Setting).findBy({ key: settingKey }),
		);
		expect(adminRows).toHaveLength(1);
	});
});
