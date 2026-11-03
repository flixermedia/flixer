import type { MigrationInterface, QueryRunner } from "typeorm";

export class RepairChatMlsWelcomeMessage1797400000000 implements MigrationInterface {
	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`ALTER TABLE "chat_mls_welcomes" ADD COLUMN IF NOT EXISTS "message_id" uuid`);
		await queryRunner.query(`
			DO $$
			BEGIN
				IF NOT EXISTS (
					SELECT 1 FROM pg_constraint WHERE conname = 'fk_chat_mls_welcomes_message'
				) THEN
					ALTER TABLE "chat_mls_welcomes"
					ADD CONSTRAINT "fk_chat_mls_welcomes_message"
					FOREIGN KEY ("message_id") REFERENCES "chat_messages"("id") ON DELETE CASCADE;
				END IF;
			END
			$$
		`);
	}

	async down(): Promise<void> {}
}
