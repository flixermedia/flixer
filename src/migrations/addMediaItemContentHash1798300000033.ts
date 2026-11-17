import type { MigrationInterface, QueryRunner } from "typeorm";

export class AddMediaItemContentHash1798300000033 implements MigrationInterface {

	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`ALTER TABLE "media_items" ADD COLUMN IF NOT EXISTS "content_hash" char(64)`);
		await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_media_items_content_hash" ON "media_items" ("library_id", "type", "content_hash") WHERE "content_hash" IS NOT NULL AND "is_placeholder" = false`);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`DROP INDEX IF EXISTS "IDX_media_items_content_hash"`);
		await queryRunner.query(`ALTER TABLE "media_items" DROP COLUMN IF EXISTS "content_hash"`);
	}
}
