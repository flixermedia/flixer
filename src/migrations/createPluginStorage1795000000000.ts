import type { MigrationInterface, QueryRunner } from "typeorm";

export class CreatePluginStorage1795000000000 implements MigrationInterface {
	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			CREATE TABLE "plugin_storage" (
				"plugin_id" varchar(128) NOT NULL,
				"scope" varchar(8) NOT NULL,
				"owner_id" varchar(128) NOT NULL,
				"key" varchar(128) NOT NULL,
				"value" jsonb NOT NULL,
				"updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
				CONSTRAINT "pk_plugin_storage" PRIMARY KEY ("plugin_id", "scope", "owner_id", "key"),
				CONSTRAINT "ck_plugin_storage_scope" CHECK ("scope" IN ('plugin', 'user'))
			)
		`);
		await queryRunner.query(
			`CREATE INDEX "idx_plugin_storage_plugin_owner" ON "plugin_storage" ("plugin_id", "scope", "owner_id")`,
		);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`DROP TABLE "plugin_storage"`);
	}
}
