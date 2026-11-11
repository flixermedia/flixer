import type { MigrationInterface, QueryRunner } from "typeorm";

export class LinkExternalAuthToPlugin1798300000023 implements MigrationInterface {
	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query('DELETE FROM "external_identities" WHERE NOT EXISTS (SELECT 1 FROM "plugin_installations" WHERE "plugin_installations"."plugin_id" = "external_identities"."plugin_id")');
		await queryRunner.query('DELETE FROM "external_auth_flows" WHERE NOT EXISTS (SELECT 1 FROM "plugin_installations" WHERE "plugin_installations"."plugin_id" = "external_auth_flows"."plugin_id")');
		await queryRunner.query('ALTER TABLE "external_identities" ADD CONSTRAINT "FK_external_identities_plugin" FOREIGN KEY ("plugin_id") REFERENCES "plugin_installations"("plugin_id") ON DELETE CASCADE');
		await queryRunner.query('ALTER TABLE "external_auth_flows" ADD CONSTRAINT "FK_external_auth_flows_plugin" FOREIGN KEY ("plugin_id") REFERENCES "plugin_installations"("plugin_id") ON DELETE CASCADE');
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query('ALTER TABLE "external_auth_flows" DROP CONSTRAINT "FK_external_auth_flows_plugin"');
		await queryRunner.query('ALTER TABLE "external_identities" DROP CONSTRAINT "FK_external_identities_plugin"');
	}
}