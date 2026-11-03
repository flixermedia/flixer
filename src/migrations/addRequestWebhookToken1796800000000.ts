import type { MigrationInterface, QueryRunner } from "typeorm";

export class AddRequestWebhookToken1796800000000 implements MigrationInterface {

	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			INSERT INTO "settings" ("key", "value", "is_public")
			VALUES ('requests_webhook_token', to_jsonb(gen_random_uuid()::text), false)
			ON CONFLICT ("key") DO NOTHING
		`);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`DELETE FROM "settings" WHERE "key" = 'requests_webhook_token'`);
	}
}
