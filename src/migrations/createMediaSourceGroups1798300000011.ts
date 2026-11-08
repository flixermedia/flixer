import type { MigrationInterface, QueryRunner } from "typeorm";

/** Stores deliberate source groupings without changing media rows or their hierarchy. */
export class CreateMediaSourceGroups1798300000011 implements MigrationInterface {
	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			CREATE TABLE media_source_groups (
				primary_id uuid NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
				source_id uuid NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
				CONSTRAINT pk_media_source_groups PRIMARY KEY (primary_id, source_id),
				CONSTRAINT uq_media_source_groups_source UNIQUE (source_id),
				CONSTRAINT ck_media_source_groups_distinct CHECK (primary_id <> source_id)
			)
		`);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query("DROP TABLE media_source_groups");
	}
}
