import type { MigrationInterface, QueryRunner } from "typeorm";

export class AddMediaMatchConfidence1798300000030 implements MigrationInterface {

	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`ALTER TABLE "media_items" ADD COLUMN IF NOT EXISTS "match_confidence" varchar(16) NOT NULL DEFAULT 'unknown'`);
		await queryRunner.query(`ALTER TABLE "media_items" ADD COLUMN IF NOT EXISTS "match_evidence" varchar(64) NOT NULL DEFAULT 'legacy_unscored'`);
		await queryRunner.query(`UPDATE "media_items" SET "match_confidence" = 'unidentified', "match_evidence" = 'no_provider_match' WHERE "is_placeholder" = false AND "provider_ids" = '{}'::jsonb`);
		await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_media_items_review_queue" ON "media_items" ("updated_at") WHERE "is_placeholder" = false AND "match_confidence" IN ('low', 'unidentified', 'unknown')`);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`DROP INDEX IF EXISTS "IDX_media_items_review_queue"`);
		await queryRunner.query(`ALTER TABLE "media_items" DROP COLUMN IF EXISTS "match_evidence"`);
		await queryRunner.query(`ALTER TABLE "media_items" DROP COLUMN IF EXISTS "match_confidence"`);
	}
}
