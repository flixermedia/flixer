import type { MigrationInterface, QueryRunner } from "typeorm";

export class CreateAdvertisements1798300000005 implements MigrationInterface {
	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			CREATE TABLE advertisement_settings (
				id integer PRIMARY KEY CHECK (id = 1),
				enabled boolean NOT NULL DEFAULT false,
				minimum_interval_seconds integer NOT NULL DEFAULT 300,
				max_per_playback integer NOT NULL DEFAULT 5
			);
			INSERT INTO advertisement_settings (id) VALUES (1);
			CREATE TABLE advertisements (
				id uuid PRIMARY KEY,
				name varchar(200) NOT NULL,
				target_url text NOT NULL,
				filename varchar(80) NOT NULL,
				enabled boolean NOT NULL DEFAULT false,
				scopes jsonb NOT NULL DEFAULT '[]',
				preroll boolean NOT NULL DEFAULT true,
				midroll_seconds jsonb NOT NULL DEFAULT '[]',
				skip_after_seconds integer,
				duration_seconds double precision NOT NULL,
				created_at timestamptz NOT NULL DEFAULT now(),
				updated_at timestamptz NOT NULL DEFAULT now()
			);
			ALTER TABLE payment_products ADD COLUMN ads_exempt boolean NOT NULL DEFAULT false;
			ALTER TABLE payment_plans ADD COLUMN ads_exempt boolean NOT NULL DEFAULT false;
		`);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			ALTER TABLE payment_plans DROP COLUMN ads_exempt;
			ALTER TABLE payment_products DROP COLUMN ads_exempt;
			DROP TABLE advertisements;
			DROP TABLE advertisement_settings;
		`);
	}
}
