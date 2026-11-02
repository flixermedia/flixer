import type { MigrationInterface, QueryRunner } from "typeorm";

export class CreateAiRecommendationCaches1796600000000 implements MigrationInterface {
	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			CREATE TABLE "ai_recommendation_caches" (
				"user_id" uuid NOT NULL,
				"entries" jsonb NOT NULL DEFAULT '{}'::jsonb,
				"last_refresh_at" TIMESTAMP WITH TIME ZONE,
				CONSTRAINT "pk_ai_recommendation_caches" PRIMARY KEY ("user_id"),
				CONSTRAINT "fk_ai_recommendation_caches_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
			)
		`);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`DROP TABLE "ai_recommendation_caches"`);
	}
}
