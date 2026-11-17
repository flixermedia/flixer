import type { MigrationInterface, QueryRunner } from "typeorm";

export class CreateUserMediaFeatures1798300000028 implements MigrationInterface {

	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			CREATE TABLE watch_later_items (
				user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
				item_id uuid NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
				added_at timestamptz NOT NULL DEFAULT now(),
				PRIMARY KEY (user_id, item_id)
			);
			CREATE INDEX idx_watch_later_user_added ON watch_later_items (user_id, added_at DESC);

			CREATE TABLE video_collections (
				id uuid PRIMARY KEY,
				user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
				name varchar(100) NOT NULL,
				description varchar(500),
				is_public boolean NOT NULL DEFAULT false,
				created_at timestamptz NOT NULL DEFAULT now(),
				updated_at timestamptz NOT NULL DEFAULT now()
			);
			CREATE INDEX idx_video_collections_user_updated ON video_collections (user_id, updated_at DESC);

			CREATE TABLE video_collection_items (
				collection_id uuid NOT NULL REFERENCES video_collections(id) ON DELETE CASCADE,
				item_id uuid NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
				position integer NOT NULL CHECK (position >= 0),
				added_at timestamptz NOT NULL DEFAULT now(),
				PRIMARY KEY (collection_id, item_id),
				UNIQUE (collection_id, position)
			);

			CREATE TABLE up_next_queue_items (
				user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
				item_id uuid NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
				position integer NOT NULL CHECK (position >= 0),
				added_at timestamptz NOT NULL DEFAULT now(),
				PRIMARY KEY (user_id, item_id),
				UNIQUE (user_id, position)
			);

			CREATE TABLE recommendation_feedback (
				user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
				item_id uuid NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
				feedback varchar(16) NOT NULL CHECK (feedback IN ('dismiss', 'more_like_this', 'less_like_this')),
				updated_at timestamptz NOT NULL DEFAULT now(),
				PRIMARY KEY (user_id, item_id)
			);
		`);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			DROP TABLE recommendation_feedback;
			DROP TABLE up_next_queue_items;
			DROP TABLE video_collection_items;
			DROP TABLE video_collections;
			DROP TABLE watch_later_items;
		`);
	}
}
