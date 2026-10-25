import type { MigrationInterface, QueryRunner } from "typeorm";

export class CreateMediaSegments1794500000000 implements MigrationInterface {

	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			CREATE TABLE "media_segments" (
				"item_id" uuid NOT NULL,
				"type" varchar(16) NOT NULL,
				"source" varchar(16) NOT NULL,
				"start_ms" integer NOT NULL,
				"end_ms" integer NOT NULL,
				"submissions" integer NOT NULL DEFAULT 0,
				"updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
				CONSTRAINT "pk_media_segments" PRIMARY KEY ("item_id", "type", "source"),
				CONSTRAINT "fk_media_segments_item" FOREIGN KEY ("item_id") REFERENCES "media_items"("id") ON DELETE CASCADE
			)
		`);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`DROP TABLE "media_segments"`);
	}
}
