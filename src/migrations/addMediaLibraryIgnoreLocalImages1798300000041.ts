import type { MigrationInterface, QueryRunner } from "typeorm";

export class AddMediaLibraryIgnoreLocalImages1798300000041 implements MigrationInterface {

	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`ALTER TABLE "media_libraries" ADD COLUMN IF NOT EXISTS "ignore_local_images" boolean NOT NULL DEFAULT false`);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`ALTER TABLE "media_libraries" DROP COLUMN IF EXISTS "ignore_local_images"`);
	}
}
