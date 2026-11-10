import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DataSource } from "typeorm";
import { RepairOidcConfiguration1798300000016 } from "./repairOidcConfiguration1798300000016.js";

const databaseUrl = process.env.OIDC_TEST_DATABASE_URL;

describe.skipIf(!databaseUrl)("OAuth configuration repair migration", () => {
	const schema = `oidc_repair_${randomUUID().replaceAll("-", "")}`;
	let admin: DataSource;
	let db: DataSource;

	beforeAll(async () => {
		admin = new DataSource({ type: "postgres", url: databaseUrl });
		await admin.initialize();
		await admin.query(`CREATE SCHEMA "${schema}"`);
		db = new DataSource({
			type: "postgres", url: databaseUrl, schema,
			extra: { options: `-c search_path=${schema}` },
			migrations: [RepairOidcConfiguration1798300000016],
		});
		await db.initialize();
		await db.query(`CREATE TABLE migrations (id SERIAL PRIMARY KEY, timestamp bigint NOT NULL, name varchar NOT NULL)`);
		await db.query(`INSERT INTO migrations (timestamp, name) VALUES (1798300000015, 'CreateOidcProvider1798300000015')`);
		await db.query(`CREATE TABLE oidc_clients (id text PRIMARY KEY)`);
		await db.query(`INSERT INTO oidc_clients (id) VALUES ('existing-client')`);
	});

	afterAll(async () => {
		if (db?.isInitialized) await db.destroy();
		if (admin?.isInitialized) {
			await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
			await admin.destroy();
		}
	});

	it("creates the missing table without changing existing OAuth data and records the repair", async () => {
		expect((await db.runMigrations()).map((migration) => migration.name)).toEqual(["RepairOidcConfiguration1798300000016"]);
		await db.query(`INSERT INTO oidc_config (key, value) VALUES ('public_origin', 'https://flixer.example')`);
		expect(await db.query(`SELECT id FROM oidc_clients`)).toEqual([{ id: "existing-client" }]);
		expect(await db.runMigrations()).toEqual([]);
		expect(await db.query(`SELECT value FROM oidc_config WHERE key = 'public_origin'`)).toEqual([{ value: "https://flixer.example" }]);
	});

	it("preserves configuration if the original migration already created the table", async () => {
		const runner = db.createQueryRunner();
		try {
			await new RepairOidcConfiguration1798300000016().up(runner);
			expect(await db.query(`SELECT value FROM oidc_config WHERE key = 'public_origin'`)).toEqual([{ value: "https://flixer.example" }]);
		} finally {
			await runner.release();
		}
	});
});
