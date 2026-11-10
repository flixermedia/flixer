import type { MigrationInterface, QueryRunner } from "typeorm";

/** History of custom theme edits, plus the settings for scheduled themes and per-library accent colours. */
export class CreateThemeVersions1798300000014 implements MigrationInterface {
	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			CREATE TABLE theme_versions (
				id uuid PRIMARY KEY,
				theme_id uuid NOT NULL REFERENCES themes(id) ON DELETE CASCADE,
				name varchar(60) NOT NULL,
				description varchar(240) NOT NULL DEFAULT '',
				config jsonb NOT NULL,
				created_at timestamptz NOT NULL DEFAULT now()
			)
		`);
		await queryRunner.query(`CREATE INDEX "IDX_theme_versions_theme_id" ON theme_versions (theme_id)`);
		await queryRunner.query(
			`INSERT INTO settings ("key", "value", "is_public") VALUES
				('theme_schedules', '[]'::jsonb, false),
				('theme_library_accents', '{}'::jsonb, false)
			ON CONFLICT ("key") DO NOTHING`,
		);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`DELETE FROM settings WHERE "key" IN ('theme_schedules', 'theme_library_accents')`);
		await queryRunner.query("DROP TABLE theme_versions");
	}
}
