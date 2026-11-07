import type { MigrationInterface, QueryRunner } from "typeorm";

export class CreateViewingAnalytics1798300000007 implements MigrationInterface {
	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			CREATE TABLE viewing_sessions (
				id uuid PRIMARY KEY,
				user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
				item_id uuid REFERENCES media_items(id) ON DELETE CASCADE,
				channel_id text,
				channel_name text,
				watched_seconds double precision NOT NULL DEFAULT 0,
				created_at timestamptz NOT NULL DEFAULT now(),
				updated_at timestamptz NOT NULL DEFAULT now(),
				CHECK ((item_id IS NOT NULL AND channel_id IS NULL AND channel_name IS NULL)
					OR (item_id IS NULL AND channel_id IS NOT NULL AND channel_name IS NOT NULL))
			);
			CREATE INDEX idx_viewing_sessions_created ON viewing_sessions (created_at);
			CREATE INDEX idx_viewing_sessions_user ON viewing_sessions (user_id);
			CREATE INDEX idx_viewing_sessions_item ON viewing_sessions (item_id);
		`);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query("DROP TABLE viewing_sessions");
	}
}
