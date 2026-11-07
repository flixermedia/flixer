import type { MigrationInterface, QueryRunner } from "typeorm";

export class CreateListeningAnalytics1798300000008 implements MigrationInterface {
	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			CREATE TABLE listening_events (
				id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
				user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
				item_id uuid NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
				created_at timestamptz NOT NULL DEFAULT now()
			);
			CREATE INDEX idx_listening_events_created ON listening_events (created_at);
			CREATE INDEX idx_listening_events_user ON listening_events (user_id);
			CREATE INDEX idx_listening_events_item ON listening_events (item_id);
		`);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query("DROP TABLE listening_events");
	}
}
