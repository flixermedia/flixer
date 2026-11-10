import type { MigrationInterface, QueryRunner } from "typeorm";
import { BUILT_IN_THEMES, DEFAULT_THEME_ID } from "../api/appearance/builtInThemes.js";

/** Creates the themes table, installs the five built-in themes and selects Flixer Default for everyone. */
export class CreateThemes1798300000013 implements MigrationInterface {
	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			CREATE TABLE themes (
				id uuid PRIMARY KEY,
				name varchar(60) NOT NULL,
				description varchar(240) NOT NULL DEFAULT '',
				is_built_in boolean NOT NULL DEFAULT false,
				config jsonb NOT NULL,
				created_at timestamptz NOT NULL DEFAULT now(),
				updated_at timestamptz NOT NULL DEFAULT now()
			)
		`);
		for (const theme of BUILT_IN_THEMES) {
			await queryRunner.query(
				`INSERT INTO themes (id, name, description, is_built_in, config) VALUES ($1, $2, $3, true, $4::jsonb)`,
				[theme.id, theme.name, theme.description, JSON.stringify(theme.config)],
			);
		}
		await queryRunner.query(
			`INSERT INTO settings ("key", "value", "is_public") VALUES
				('active_theme_id', $1::jsonb, false),
				('theme_user_selection_enabled', 'false'::jsonb, false),
				('theme_user_selectable_ids', '[]'::jsonb, false)
			ON CONFLICT ("key") DO NOTHING`,
			[JSON.stringify(DEFAULT_THEME_ID)],
		);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`DELETE FROM settings WHERE "key" IN ('active_theme_id', 'theme_user_selection_enabled', 'theme_user_selectable_ids')`);
		await queryRunner.query("DROP TABLE themes");
	}
}
