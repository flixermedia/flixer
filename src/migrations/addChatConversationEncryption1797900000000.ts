import type { MigrationInterface, QueryRunner } from "typeorm";

export class AddChatConversationEncryption1797900000000 implements MigrationInterface {
	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			ALTER TABLE "chat_conversations"
			ADD COLUMN "encryption_mode" text NOT NULL DEFAULT 'plaintext'
		`);
		await queryRunner.query(`
			UPDATE "chat_conversations"
			SET "encryption_mode" = CASE
				WHEN (SELECT "value" FROM "settings" WHERE "key" = 'chat_e2ee_enabled') = 'true'::jsonb THEN 'encrypted'
				ELSE 'plaintext'
			END
		`);
		await queryRunner.query(`
			ALTER TABLE "chat_conversations"
			ADD CONSTRAINT "chk_chat_conversation_encryption_mode"
			CHECK ("encryption_mode" IN ('encrypted', 'plaintext'))
		`);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`ALTER TABLE "chat_conversations" DROP CONSTRAINT "chk_chat_conversation_encryption_mode"`);
		await queryRunner.query(`ALTER TABLE "chat_conversations" DROP COLUMN "encryption_mode"`);
	}
}
