import type { MigrationInterface, QueryRunner } from "typeorm";

export class CreateExternalOAuthProviders1798300000026 implements MigrationInterface {
	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`CREATE TABLE "external_oauth_providers" (
			"id" uuid NOT NULL,
			"plugin_id" varchar(128) NOT NULL,
			"name" varchar(128) NOT NULL,
			"enabled" boolean NOT NULL DEFAULT false,
			"settings" jsonb NOT NULL,
			"secret_cipher" text,
			"revision" uuid NOT NULL,
			CONSTRAINT "PK_external_oauth_providers" PRIMARY KEY ("id"),
			CONSTRAINT "FK_external_oauth_providers_plugin" FOREIGN KEY ("plugin_id") REFERENCES "plugin_installations"("plugin_id") ON DELETE CASCADE
		)`);
		await queryRunner.query('CREATE INDEX "IDX_external_oauth_providers_plugin" ON "external_oauth_providers" ("plugin_id")');
		await queryRunner.query('ALTER TABLE "external_identities" ADD COLUMN "provider_key" varchar(36) NOT NULL DEFAULT \'\'');
		await queryRunner.query('ALTER TABLE "external_identities" DROP CONSTRAINT "PK_external_identities"');
		await queryRunner.query('ALTER TABLE "external_identities" ADD CONSTRAINT "PK_external_identities" PRIMARY KEY ("plugin_id", "provider_key", "identity_hash")');
		await queryRunner.query('ALTER TABLE "external_auth_flows" ADD COLUMN "provider_key" varchar(36) NOT NULL DEFAULT \'\'');
		await queryRunner.query('ALTER TABLE "external_auth_flows" ADD COLUMN "provider_revision" uuid');
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`DO $$ BEGIN
			IF EXISTS (SELECT 1 FROM "external_identities" WHERE "provider_key" <> '') THEN
				RAISE EXCEPTION 'Remove configured OAuth provider links before reverting this migration';
			END IF;
		END $$`);
		await queryRunner.query('ALTER TABLE "external_auth_flows" DROP COLUMN "provider_revision"');
		await queryRunner.query('ALTER TABLE "external_auth_flows" DROP COLUMN "provider_key"');
		await queryRunner.query('ALTER TABLE "external_identities" DROP CONSTRAINT "PK_external_identities"');
		await queryRunner.query('ALTER TABLE "external_identities" DROP COLUMN "provider_key"');
		await queryRunner.query('ALTER TABLE "external_identities" ADD CONSTRAINT "PK_external_identities" PRIMARY KEY ("plugin_id", "identity_hash")');
		await queryRunner.query('DROP TABLE "external_oauth_providers"');
	}
}