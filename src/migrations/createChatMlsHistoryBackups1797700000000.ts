import type { MigrationInterface, QueryRunner } from "typeorm";

export class CreateChatMlsHistoryBackups1797700000000 implements MigrationInterface {
	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			CREATE TABLE "chat_mls_history_backups" (
				"user_id" uuid NOT NULL,
				"backup" text NOT NULL,
				"updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
				CONSTRAINT "pk_chat_mls_history_backups" PRIMARY KEY ("user_id"),
				CONSTRAINT "fk_chat_mls_history_backups_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
			)
		`);
		await queryRunner.query(`UPDATE "chat_mls_devices" SET "status" = 'active', "approval_challenge" = NULL, "approved_at" = COALESCE("approved_at", now()) WHERE "status" = 'pending'`);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`DROP TABLE "chat_mls_history_backups"`);
	}
}
