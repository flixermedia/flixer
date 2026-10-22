import type { MigrationInterface, QueryRunner } from "typeorm";

export class CreateWatchProgress1793800000000 implements MigrationInterface {

	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			CREATE TABLE "watch_progress" (
				"user_id" uuid NOT NULL,
				"item_id" uuid NOT NULL,
				"position_seconds" integer NOT NULL DEFAULT 0,
				"duration_seconds" integer NOT NULL DEFAULT 0,
				"completed" boolean NOT NULL DEFAULT false,
				"updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
				CONSTRAINT "pk_watch_progress" PRIMARY KEY ("user_id", "item_id"),
				CONSTRAINT "fk_watch_progress_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,
				CONSTRAINT "fk_watch_progress_item" FOREIGN KEY ("item_id") REFERENCES "media_items"("id") ON DELETE CASCADE
			)
		`);
		await queryRunner.query(`CREATE INDEX "idx_watch_progress_user_updated" ON "watch_progress" ("user_id", "updated_at")`);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`DROP TABLE "watch_progress"`);
	}
}
