import type { MigrationInterface, QueryRunner } from "typeorm";

export class CreatePlaybackHistory1798300000027 implements MigrationInterface {
	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			CREATE TABLE playback_history (
				id uuid PRIMARY KEY,
				user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
				kind varchar(8) NOT NULL CHECK (kind IN ('video', 'music', 'live')),
				item_id uuid REFERENCES media_items(id) ON DELETE CASCADE,
				channel_id text,
				channel_name text,
				watched_seconds real NOT NULL DEFAULT 0 CHECK (watched_seconds >= 0),
				started_at timestamptz NOT NULL DEFAULT now(),
				updated_at timestamptz NOT NULL DEFAULT now(),
				CHECK ((kind = 'live' AND item_id IS NULL AND channel_id IS NOT NULL AND channel_name IS NOT NULL)
					OR (kind IN ('video', 'music') AND item_id IS NOT NULL AND channel_id IS NULL AND channel_name IS NULL))
			);
			CREATE INDEX idx_playback_history_user_started ON playback_history (user_id, started_at DESC);
			CREATE INDEX idx_playback_history_user_item ON playback_history (user_id, item_id);
			CREATE TABLE playback_history_hidden_sessions (
				user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
				id uuid NOT NULL,
				PRIMARY KEY (user_id, id)
			);
			INSERT INTO playback_history (id, user_id, kind, item_id, channel_id, channel_name, watched_seconds, started_at, updated_at)
			SELECT id, user_id, CASE WHEN item_id IS NULL THEN 'live' ELSE 'video' END,
				item_id, channel_id, channel_name, GREATEST(0, LEAST(watched_seconds, 86400)), created_at, updated_at
			FROM viewing_sessions;
			INSERT INTO playback_history (id, user_id, kind, item_id, started_at, updated_at)
			SELECT gen_random_uuid(), event.user_id, 'music', event.item_id, event.created_at, event.created_at
			FROM listening_events event JOIN media_items item ON item.id = event.item_id WHERE item.type = 'track';
		`);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query("DROP TABLE playback_history_hidden_sessions; DROP TABLE playback_history");
	}
}