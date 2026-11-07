import type { MigrationInterface, QueryRunner } from "typeorm";

export class CreateAdvertisementAnalytics1798300000006 implements MigrationInterface {
	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			CREATE TABLE advertisement_views (
				id uuid PRIMARY KEY,
				user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
				advertisement_id uuid NOT NULL REFERENCES advertisements(id) ON DELETE CASCADE,
				watched_seconds double precision NOT NULL DEFAULT 0,
				completed boolean NOT NULL DEFAULT false,
				skipped boolean NOT NULL DEFAULT false,
				clicked boolean NOT NULL DEFAULT false,
				created_at timestamptz NOT NULL DEFAULT now(),
				updated_at timestamptz NOT NULL DEFAULT now()
			);
			CREATE INDEX idx_advertisement_views_ad ON advertisement_views (advertisement_id);
			CREATE INDEX idx_advertisement_views_created ON advertisement_views (created_at);
		`);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query("DROP TABLE advertisement_views");
	}
}
