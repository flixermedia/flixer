import type { MigrationInterface, QueryRunner } from "typeorm";

export class AddExternalAuthFlowNonce1798300000024 implements MigrationInterface {
	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query('ALTER TABLE "external_auth_flows" ADD COLUMN IF NOT EXISTS "nonce_hash" varchar(64)');
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query('ALTER TABLE "external_auth_flows" DROP COLUMN IF EXISTS "nonce_hash"');
	}
}