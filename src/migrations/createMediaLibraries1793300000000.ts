import type { MigrationInterface, QueryRunner } from "typeorm";

export class CreateMediaLibraries1793300000000 implements MigrationInterface {

	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
      CREATE TABLE "media_libraries" (
        "id" uuid NOT NULL,
        "name" character varying(100) NOT NULL,
        "type" character varying(32) NOT NULL,
        "folders" jsonb NOT NULL DEFAULT '[]',
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_media_libraries_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_media_libraries_name" UNIQUE ("name")
      )
    `);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query('DROP TABLE "media_libraries"');
	}
}
