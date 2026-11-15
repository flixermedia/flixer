import type { MigrationInterface, QueryRunner } from "typeorm";

export class RepairPlaybackHistory1798300000029 implements MigrationInterface {
	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			CREATE TABLE IF NOT EXISTS playback_history_hidden_sessions (
				user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
				id uuid NOT NULL,
				PRIMARY KEY (user_id, id)
			);
			ALTER TABLE playback_history DROP CONSTRAINT IF EXISTS playback_history_item_id_fkey;
			ALTER TABLE playback_history ADD CONSTRAINT playback_history_item_id_fkey
				FOREIGN KEY (item_id) REFERENCES media_items(id) ON DELETE CASCADE;

			INSERT INTO playback_history (id, user_id, kind, item_id, channel_id, channel_name, watched_seconds, started_at, updated_at)
			SELECT session.id, session.user_id, CASE WHEN session.item_id IS NULL THEN 'live' ELSE 'video' END,
				session.item_id, session.channel_id, session.channel_name,
				GREATEST(0, LEAST(session.watched_seconds, 86400)), session.created_at, session.updated_at
			FROM viewing_sessions session
			WHERE NOT EXISTS (SELECT 1 FROM playback_history_hidden_sessions hidden WHERE hidden.user_id = session.user_id AND hidden.id = session.id)
			ON CONFLICT (id) DO NOTHING;

			INSERT INTO playback_history (id, user_id, kind, item_id, started_at, updated_at)
			SELECT gen_random_uuid(), event.user_id, 'music', event.item_id, event.created_at, event.created_at
			FROM listening_events event JOIN media_items item ON item.id = event.item_id AND item.type = 'track'
			WHERE NOT EXISTS (SELECT 1 FROM playback_history_hidden_sessions hidden WHERE hidden.user_id = event.user_id)
			AND NOT EXISTS (SELECT 1 FROM playback_history history WHERE history.user_id = event.user_id AND history.item_id = event.item_id AND history.kind = 'music' AND history.started_at = event.created_at);

			INSERT INTO playback_history (id, user_id, kind, item_id, watched_seconds, started_at, updated_at)
			SELECT gen_random_uuid(), progress.user_id, 'video', progress.item_id,
				GREATEST(0, progress.position_seconds), progress.updated_at, progress.updated_at
			FROM watch_progress progress JOIN media_items item ON item.id = progress.item_id AND item.type IN ('movie', 'episode', 'video')
			WHERE NOT EXISTS (SELECT 1 FROM playback_history_hidden_sessions hidden WHERE hidden.user_id = progress.user_id)
			AND NOT EXISTS (SELECT 1 FROM playback_history history WHERE history.user_id = progress.user_id AND history.item_id = progress.item_id AND history.kind = 'video');

			INSERT INTO playback_history (id, user_id, kind, item_id, started_at, updated_at)
			SELECT gen_random_uuid(), listening.user_id, 'music', listening.item_id, listening.played_at, listening.played_at
			FROM listening_history listening JOIN media_items item ON item.id = listening.item_id AND item.type = 'track'
			WHERE NOT EXISTS (SELECT 1 FROM playback_history_hidden_sessions hidden WHERE hidden.user_id = listening.user_id)
			AND NOT EXISTS (SELECT 1 FROM playback_history history WHERE history.user_id = listening.user_id AND history.item_id = listening.item_id AND history.kind = 'music');
		`);
	}

	async down(): Promise<void> {}
}