import type { MigrationInterface, QueryRunner } from "typeorm";

export class CreatePluginManager1794800000000 implements MigrationInterface {
	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			CREATE TABLE IF NOT EXISTS "plugin_repositories" (
				"id" uuid NOT NULL DEFAULT gen_random_uuid(),
				"name" varchar(120) NOT NULL,
				"url" varchar(2048) NOT NULL,
				"is_official" boolean NOT NULL DEFAULT false,
				"enabled" boolean NOT NULL DEFAULT true,
				"last_checked_at" TIMESTAMP WITH TIME ZONE,
				"last_error" text,
				"manifest" jsonb,
				"created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
				"updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
				CONSTRAINT "pk_plugin_repositories" PRIMARY KEY ("id")
			)
		`);
		await queryRunner.query(
			`CREATE UNIQUE INDEX IF NOT EXISTS "uq_plugin_repositories_url" ON "plugin_repositories" ("url")`,
		);
		await queryRunner.query(`
			CREATE TABLE IF NOT EXISTS "plugin_installations" (
				"plugin_id" varchar(128) NOT NULL,
				"repository_id" uuid,
				"version" varchar(64) NOT NULL,
				"package_digest" varchar(64) NOT NULL,
				"install_path" text NOT NULL,
				"manifest" jsonb NOT NULL,
				"status" varchar(16) NOT NULL DEFAULT 'installed',
				"enabled" boolean NOT NULL DEFAULT false,
				"approved_permissions" jsonb NOT NULL DEFAULT '[]'::jsonb,
				"settings" jsonb NOT NULL DEFAULT '{}'::jsonb,
				"encrypted_secrets" jsonb NOT NULL DEFAULT '{}'::jsonb,
				"target_status" jsonb NOT NULL DEFAULT '{}'::jsonb,
				"last_error" text,
				"installed_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
				"updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
				CONSTRAINT "pk_plugin_installations" PRIMARY KEY ("plugin_id"),
				CONSTRAINT "fk_plugin_installations_repository" FOREIGN KEY ("repository_id") REFERENCES "plugin_repositories"("id") ON DELETE SET NULL,
				CONSTRAINT "ck_plugin_installations_status" CHECK ("status" IN ('installed', 'initializing', 'enabled', 'running', 'disabled', 'error', 'updating'))
			)
		`);
		await queryRunner.query(
			`CREATE INDEX IF NOT EXISTS "idx_plugin_installations_repository" ON "plugin_installations" ("repository_id")`,
		);
		await queryRunner.query(`
			INSERT INTO "plugin_repositories" ("name", "url", "is_official", "enabled")
			VALUES ('Official Flixer Plugins', 'https://raw.githubusercontent.com/flixermedia/flixer-plugins/main/repository.json', true, true)
			ON CONFLICT ("url") DO UPDATE SET "name" = EXCLUDED."name", "is_official" = true, "enabled" = true
		`);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`DROP TABLE IF EXISTS "plugin_installations"`);
		await queryRunner.query(`DROP TABLE IF EXISTS "plugin_repositories"`);
	}
}
