import type { MigrationInterface, QueryRunner } from "typeorm";

export class AddExternalAuthFlowRedirectUri1798300000025 implements MigrationInterface {
	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query('ALTER TABLE "external_auth_flows" ADD COLUMN IF NOT EXISTS "redirect_uri" text');
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query('ALTER TABLE "external_auth_flows" DROP COLUMN IF EXISTS "redirect_uri"');
	}
}