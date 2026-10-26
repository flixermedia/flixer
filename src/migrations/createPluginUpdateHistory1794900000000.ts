import type { MigrationInterface, QueryRunner } from "typeorm";

export class CreatePluginUpdateHistory1794900000000 implements MigrationInterface {
	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			CREATE TABLE IF NOT EXISTS "plugin_update_history" (
				"id" uuid NOT NULL DEFAULT gen_random_uuid(),
				"plugin_id" varchar(128) NOT NULL,
				"action" varchar(16) NOT NULL,
				"from_version" varchar(64),
				"to_version" varchar(64) NOT NULL,
				"outcome" varchar(16) NOT NULL,
				"error_message" text,
				"created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
				CONSTRAINT "pk_plugin_update_history" PRIMARY KEY ("id"),
				CONSTRAINT "ck_plugin_update_history_action" CHECK ("action" IN ('install', 'update')),
				CONSTRAINT "ck_plugin_update_history_outcome" CHECK ("outcome" IN ('succeeded', 'failed'))
			)
		`);
		await queryRunner.query(`
			CREATE INDEX IF NOT EXISTS "idx_plugin_update_history_plugin_created"
			ON "plugin_update_history" ("plugin_id", "created_at" DESC)
		`);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`DROP TABLE IF EXISTS "plugin_update_history"`);
	}
}
