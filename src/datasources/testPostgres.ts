import { randomUUID } from "node:crypto";
import { DataSource, type DataSourceOptions } from "typeorm";
import { ENTITIES } from "./entityList.js";
import { MIGRATIONS } from "./migrationList.js";

export const HEAVY_HOOK_TIMEOUT = 120_000;

export interface IsolatedSchema {
	db: DataSource;
	schema: string;
	drop(): Promise<void>;
}

export async function createIsolatedSchema(connection: string | Extract<DataSourceOptions, { type: "postgres" }>, options: { prefix: string; migrate?: boolean; synchronize?: boolean; entities?: DataSourceOptions["entities"]; migrations?: DataSourceOptions["migrations"] }): Promise<IsolatedSchema> {

	if (!/^[a-z][a-z0-9_]*$/.test(options.prefix)) throw new Error("Invalid test schema prefix.");
	const schema = `${options.prefix}_${randomUUID().replaceAll("-", "")}`;
	const config = typeof connection === "string" ? { type: "postgres" as const, url: connection } : connection;
	const admin = new DataSource(config);
	const db = new DataSource({ ...config, schema, extra: { ...config.extra, options: `-c search_path=${schema}` }, entities: options.entities ?? ENTITIES, migrations: options.migrations ?? MIGRATIONS, synchronize: options.synchronize ?? false });
	let created = false;
	const drop = async () => {
		try {
			if (db.isInitialized) await db.destroy();
			if (created && admin.isInitialized) await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
		} finally {
			if (admin.isInitialized) await admin.destroy();
		}
	};
	try {
		await admin.initialize();
		await admin.query(`CREATE SCHEMA "${schema}"`);
		created = true;
		await db.initialize();
		if (options.migrate !== false) await db.runMigrations();
		return { db, schema, drop };
	} catch (error) {
		await drop();
		throw error;
	}

}
