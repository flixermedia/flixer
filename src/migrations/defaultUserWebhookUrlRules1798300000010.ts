import type { MigrationInterface, QueryRunner } from "typeorm";

/** Allows HTTP(S) destinations by default while retaining existing custom rules. */
export class DefaultUserWebhookUrlRules1798300000010 implements MigrationInterface {
	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			ALTER TABLE user_webhook_config ALTER COLUMN allowed_urls SET DEFAULT '["regex:https?://.*"]'::jsonb;
			UPDATE user_webhook_config SET allowed_urls = '["regex:https?://.*"]'::jsonb WHERE allowed_urls = '[]'::jsonb;
		`);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			ALTER TABLE user_webhook_config ALTER COLUMN allowed_urls SET DEFAULT '[]'::jsonb;
			UPDATE user_webhook_config SET allowed_urls = '[]'::jsonb WHERE allowed_urls = '["regex:https?://.*"]'::jsonb;
		`);
	}
}
