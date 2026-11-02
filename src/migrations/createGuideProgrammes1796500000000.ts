import type { MigrationInterface, QueryRunner } from "typeorm";

export class CreateGuideProgrammes1796500000000 implements MigrationInterface {
	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			CREATE TABLE "guide_programmes" (
				"id" uuid NOT NULL,
				"source_id" uuid NOT NULL,
				"channel_external_id" text NOT NULL,
				"start_ms" bigint NOT NULL,
				"stop_ms" bigint NOT NULL,
				"title" text NOT NULL,
				"subtitle" text,
				"description" text,
				"category" text,
				CONSTRAINT "pk_guide_programmes" PRIMARY KEY ("id"),
				CONSTRAINT "fk_guide_programmes_source" FOREIGN KEY ("source_id") REFERENCES "guide_sources"("id") ON DELETE CASCADE
			)
		`);
		await queryRunner.query(`
			CREATE INDEX "IDX_guide_programmes_channel_window"
			ON "guide_programmes" ("source_id", "channel_external_id", "start_ms", "stop_ms")
		`);
		await queryRunner.query(`
			INSERT INTO "guide_programmes" (
				"id", "source_id", "channel_external_id", "start_ms", "stop_ms", "title", "subtitle", "description", "category"
			)
			SELECT
				gen_random_uuid(),
				"source"."id",
				"programme"->>'channelExternalId',
				("programme"->>'start')::bigint,
				("programme"->>'stop')::bigint,
				"programme"->>'title',
				"programme"->>'subtitle',
				"programme"->>'description',
				"programme"->>'category'
			FROM "guide_sources" AS "source"
			CROSS JOIN LATERAL jsonb_array_elements("source"."cache"->'programmes') AS "programme"
			WHERE "source"."kind" = 'epg'
		`);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`DROP TABLE "guide_programmes"`);
	}
}
