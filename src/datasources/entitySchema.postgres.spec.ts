// Schema safety net: entities must match what the hand-written migrations create.
// Run with a throwaway PostgreSQL server:
//   ENTITY_SCHEMA_TEST_DATABASE_URL=postgres://... npx vitest run src/datasources/entitySchema.postgres.spec.ts
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DataSource } from "typeorm";
import { ENTITIES } from "./entityList.js";
import { MIGRATIONS } from "./migrationList.js";

const databaseUrl = process.env.ENTITY_SCHEMA_TEST_DATABASE_URL;

/** Entity tables whose schema already differs from the migrations; fix the drift, then remove the entry. */
const KNOWN_DRIFT_TABLES = new Set<string>([
	"advertisement_settings", // check constraints
	"ai_recommendation_caches", // column defaults, foreign keys
	"api_keys", // foreign keys
	"external_auth_flows", // foreign keys
	"external_identities", // foreign keys
	"external_oauth_providers", // column defaults, foreign keys
	"favorites", // foreign keys
	"guide_programmes", // foreign keys
	"guide_settings", // check constraints
	"guide_sources", // check constraints, column defaults, index names/definitions, unique constraints
	"listening_history", // foreign keys
	"mail_messages", // check constraints, foreign keys
	"mail_server_settings", // check constraints
	"mailboxes", // check constraints, foreign keys
	"media_credits", // foreign keys
	"media_items", // foreign keys, index names/definitions
	"media_organization_plan_audit", // foreign keys
	"media_organization_plans", // foreign keys
	"media_organization_settings", // foreign keys
	"media_requests", // foreign keys
	"media_segments", // foreign keys
	"native_passkey_handoffs", // foreign keys
	"notifications", // foreign keys
	"passkey_credentials", // foreign keys
	"payment_customers", // index names/definitions
	"payment_entitlements", // index names/definitions
	"payment_events", // index names/definitions
	"payment_methods", // index names/definitions
	"payment_orders", // index names/definitions
	"payment_subscriptions", // index names/definitions
	"playback_history", // check constraints, foreign keys
	"playlist_items", // foreign keys
	"playlists", // foreign keys
	"plugin_installations", // check constraints, column defaults, foreign keys
	"plugin_storage", // check constraints, index names/definitions
	"plugin_update_history", // check constraints
	"push_subscriptions", // foreign keys
	"quick_connect_requests", // check constraints, foreign keys
	"request_services", // foreign keys
	"request_user_limits", // foreign keys
	"settings", // unique constraints
	"theme_versions", // foreign keys, index names/definitions
	"user_access_policies", // foreign keys
	"user_preferences", // column defaults, foreign keys
	"user_sessions", // foreign keys
	"users", // check constraints
	"watch_progress", // foreign keys
]);

describe.skipIf(!databaseUrl)("entities match the migrated schema", () => {
	const schema = `entity_schema_${randomUUID().replaceAll("-", "")}`;
	let admin: DataSource;
	let db: DataSource;

	beforeAll(async () => {
		admin = new DataSource({ type: "postgres", url: databaseUrl });
		await admin.initialize();
		await admin.query(`CREATE SCHEMA "${schema}"`);
		db = new DataSource({
			type: "postgres",
			url: databaseUrl,
			extra: { options: `-c search_path=${schema}` },
			schema,
			entities: ENTITIES,
			migrations: MIGRATIONS,
			synchronize: false,
			migrationsRun: false,
		});
		await db.initialize();
		await db.runMigrations();
	});

	afterAll(async () => {
		if (db?.isInitialized) await db.destroy();
		if (admin?.isInitialized) {
			await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
			await admin.destroy();
		}
	});

	it("has no pending schema changes for entity-backed tables", async () => {
		const log = await db.driver.createSchemaBuilder().log();
		const entityTables = new Set(db.entityMetadatas.map((metadata) => metadata.tableName));
		const indexRows: { indexname: string; tablename: string }[] = await db.query("SELECT indexname, tablename FROM pg_indexes WHERE schemaname = $1", [schema]);
		const indexTables = new Map(indexRows.map((row) => [row.indexname, row.tablename]));
		const tableOf = (query: string) => /^ALTER TABLE "([^"]+)"/.exec(query)?.[1] ?? /^CREATE (?:UNIQUE )?INDEX .* ON "([^"]+)"/.exec(query)?.[1] ?? indexTables.get(/^DROP INDEX "[^"]+"\."([^"]+)"/.exec(query)?.[1] ?? "");
		const pending = log.upQueries
			.map((query) => query.query)
			.filter((query) => {
				const table = tableOf(query);
				return table === undefined || (entityTables.has(table) && !KNOWN_DRIFT_TABLES.has(table));
			});
		expect(pending).toEqual([]);
	});
});
