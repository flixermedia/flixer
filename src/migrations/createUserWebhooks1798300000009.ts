import type { MigrationInterface, QueryRunner } from "typeorm";

/** Stores opt-in webhook policy and per-user destinations. */
export class CreateUserWebhooks1798300000009 implements MigrationInterface {
	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			CREATE TABLE user_webhook_config (
				id integer PRIMARY KEY CHECK (id = 1),
				enabled boolean NOT NULL DEFAULT false,
				audience text NOT NULL DEFAULT 'admins' CHECK (audience IN ('admins', 'everyone')),
				allowed_urls jsonb NOT NULL DEFAULT '[]'::jsonb
			);
			INSERT INTO user_webhook_config (id) VALUES (1);
			CREATE TABLE user_webhooks (
				id uuid PRIMARY KEY,
				user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
				name varchar(100) NOT NULL,
				url text NOT NULL,
				enabled boolean NOT NULL DEFAULT true,
				created_at timestamptz NOT NULL DEFAULT now()
			);
			CREATE INDEX idx_user_webhooks_user ON user_webhooks(user_id);
		`);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query("DROP TABLE user_webhooks; DROP TABLE user_webhook_config");
	}
}
