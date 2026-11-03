import type { MigrationInterface, QueryRunner } from "typeorm";

export class RepairChatMlsWelcomeColumns1797500000000 implements MigrationInterface {
	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`ALTER TABLE "chat_mls_welcomes" ADD COLUMN IF NOT EXISTS "key_package_id" uuid`);
		await queryRunner.query(`ALTER TABLE "chat_mls_welcomes" ADD COLUMN IF NOT EXISTS "message_id" uuid`);
		await queryRunner.query(`
			UPDATE "chat_mls_welcomes"
			SET "consumed_at" = COALESCE("consumed_at", now())
			WHERE "key_package_id" IS NULL OR "message_id" IS NULL
		`);
		await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "uq_chat_mls_welcomes_key_package" ON "chat_mls_welcomes" ("conversation_id", "key_package_id")`);
		await queryRunner.query(`
			DO $$
			BEGIN
				IF NOT EXISTS (
					SELECT 1 FROM pg_constraint
					WHERE conname = 'fk_chat_mls_welcomes_key_package'
					AND conrelid = '"chat_mls_welcomes"'::regclass
				) THEN
					ALTER TABLE "chat_mls_welcomes"
					ADD CONSTRAINT "fk_chat_mls_welcomes_key_package"
					FOREIGN KEY ("key_package_id") REFERENCES "chat_mls_key_packages"("id") ON DELETE CASCADE;
				END IF;
				IF NOT EXISTS (
					SELECT 1 FROM pg_constraint
					WHERE conname = 'fk_chat_mls_welcomes_message'
					AND conrelid = '"chat_mls_welcomes"'::regclass
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
