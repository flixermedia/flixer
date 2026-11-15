import type { MigrationInterface, QueryRunner } from "typeorm";

export class AddMediaLibraryWritePermissions1798300000034 implements MigrationInterface {
	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`ALTER TABLE "media_organization_settings" ADD COLUMN IF NOT EXISTS "organization_writes_enabled" boolean NOT NULL DEFAULT false`);
		await queryRunner.query(`ALTER TABLE "media_organization_settings" ADD COLUMN IF NOT EXISTS "nfo_writes_enabled" boolean NOT NULL DEFAULT false`);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`ALTER TABLE "media_organization_settings" DROP COLUMN IF EXISTS "nfo_writes_enabled"`);
		await queryRunner.query(`ALTER TABLE "media_organization_settings" DROP COLUMN IF EXISTS "organization_writes_enabled"`);
	}
}