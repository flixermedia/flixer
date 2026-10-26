import type { MigrationInterface, QueryRunner } from "typeorm";

export class CreatePluginSecrets1795100000000 implements MigrationInterface {
	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			CREATE TABLE IF NOT EXISTS "plugin_secrets" (
				"plugin_id" varchar(128) NOT NULL,
				"name" varchar(128) NOT NULL,
				"value" text NOT NULL,
				"updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
				CONSTRAINT "pk_plugin_secrets" PRIMARY KEY ("plugin_id", "name")
			)
		`);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`DROP TABLE IF EXISTS "plugin_secrets"`);
	}
}
