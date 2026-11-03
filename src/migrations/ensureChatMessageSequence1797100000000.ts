import type { MigrationInterface, QueryRunner } from "typeorm";

export class EnsureChatMessageSequence1797100000000 implements MigrationInterface {
	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`ALTER TABLE "chat_messages" ADD COLUMN IF NOT EXISTS "sequence" bigserial NOT NULL`);
		await queryRunner.query(`ALTER TABLE "chat_messages" ALTER COLUMN "sequence" SET NOT NULL`);
		await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_chat_messages_conversation_sequence" ON "chat_messages" ("conversation_id", "sequence")`);
	}

	async down(): Promise<void> {}
}
