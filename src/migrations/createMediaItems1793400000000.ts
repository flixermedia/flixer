import type { MigrationInterface, QueryRunner } from "typeorm";

export class CreateMediaItems1793400000000 implements MigrationInterface {

	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`ALTER TABLE "media_libraries" ADD "image_storage" character varying(16) NOT NULL DEFAULT 'cache'`);
		await queryRunner.query(`
      CREATE TABLE "media_items" (
        "id" uuid NOT NULL,
        "library_id" uuid NOT NULL,
        "parent_id" uuid,
        "type" character varying(16) NOT NULL,
        "external_key" text NOT NULL,
        "path" text NOT NULL,
        "root_id" character varying(64),
        "relative_path" text,
        "title" text NOT NULL,
        "sort_title" text,
        "year" integer,
        "season_number" integer,
        "episode_number" integer,
        "episode_end_number" integer,
        "provider_ids" jsonb NOT NULL DEFAULT '{}',
        "metadata" jsonb NOT NULL DEFAULT '{}',
        "images" jsonb NOT NULL DEFAULT '[]',
        "technical" jsonb,
        "size_bytes" bigint,
        "modified_at" TIMESTAMP WITH TIME ZONE,
        "nfo_present" boolean NOT NULL DEFAULT false,
        "local_images_used" boolean NOT NULL DEFAULT false,
        "is_placeholder" boolean NOT NULL DEFAULT false,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_media_items_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_media_items_library" FOREIGN KEY ("library_id") REFERENCES "media_libraries" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_media_items_parent" FOREIGN KEY ("parent_id") REFERENCES "media_items" ("id") ON DELETE CASCADE
      )
    `);
		await queryRunner.query(`CREATE UNIQUE INDEX "UQ_media_items_library_key" ON "media_items" ("library_id", "external_key")`);
		await queryRunner.query(`CREATE INDEX "IDX_media_items_library_path" ON "media_items" ("library_id", "path")`);
		await queryRunner.query(`CREATE INDEX "IDX_media_items_parent" ON "media_items" ("parent_id")`);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query('DROP TABLE "media_items"');
		await queryRunner.query('ALTER TABLE "media_libraries" DROP COLUMN "image_storage"');
	}
}
