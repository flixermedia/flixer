import type { MigrationInterface, QueryRunner } from "typeorm";

export class AddAiRecommendationCacheScopes1796700000000 implements MigrationInterface {
	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			ALTER TABLE "ai_recommendation_caches"
			ADD COLUMN "entry_scopes" jsonb NOT NULL DEFAULT '{}'::jsonb,
			ADD COLUMN "refresh_times" jsonb NOT NULL DEFAULT '{}'::jsonb
		`);
		await queryRunner.query(`
			UPDATE "ai_recommendation_caches"
			SET "refresh_times" = jsonb_build_object('movies', "last_refresh_at"::text)
			WHERE "last_refresh_at" IS NOT NULL
		`);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			ALTER TABLE "ai_recommendation_caches"
			DROP COLUMN "refresh_times",
			DROP COLUMN "entry_scopes"
		`);
	}
}
