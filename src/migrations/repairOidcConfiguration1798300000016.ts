import type { MigrationInterface, QueryRunner } from "typeorm";

/** Repairs installations that recorded the original OAuth migration without its configuration table. */
export class RepairOidcConfiguration1798300000016 implements MigrationInterface {
	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`CREATE TABLE IF NOT EXISTS "oidc_config" ("key" varchar(64) PRIMARY KEY, "value" text NOT NULL)`);
	}

	async down(): Promise<void> {
		// The original migration owns this table and its data.
	}
}
