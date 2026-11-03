import type { MigrationInterface, QueryRunner } from "typeorm";

export class AddChatMessageEncryption1797800000000 implements MigrationInterface {
	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`ALTER TABLE "chat_messages" ADD COLUMN "encrypted" boolean NOT NULL DEFAULT false`);
		await queryRunner.query(`
			UPDATE "chat_messages"
			SET "encrypted" = true
			WHERE "kind" = 'text'
				AND EXISTS (
					SELECT 1 FROM "settings"
					WHERE "key" = 'chat_e2ee_enabled' AND "value" = 'true'::jsonb
				)
		`);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`ALTER TABLE "chat_messages" DROP COLUMN "encrypted"`);
	}
}
