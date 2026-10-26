import type { MigrationInterface, QueryRunner } from "typeorm";

export class CreateChat1795500000000 implements MigrationInterface {

	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			CREATE TABLE "chat_conversations" (
				"id" uuid NOT NULL,
				"kind" varchar(8) NOT NULL,
				"name" varchar(60),
				"direct_key" varchar(80),
				"created_by" uuid,
				"created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
				"last_message_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
				CONSTRAINT "pk_chat_conversations" PRIMARY KEY ("id"),
				CONSTRAINT "fk_chat_conversations_creator" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL
			)
		`);
		await queryRunner.query(`CREATE UNIQUE INDEX "uq_chat_conversations_direct_key" ON "chat_conversations" ("direct_key") WHERE "direct_key" IS NOT NULL`);
		await queryRunner.query(`
			CREATE TABLE "chat_members" (
				"conversation_id" uuid NOT NULL,
				"user_id" uuid NOT NULL,
				"role" varchar(8) NOT NULL DEFAULT 'member',
				"joined_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
				"last_read_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
				CONSTRAINT "pk_chat_members" PRIMARY KEY ("conversation_id", "user_id"),
				CONSTRAINT "fk_chat_members_conversation" FOREIGN KEY ("conversation_id") REFERENCES "chat_conversations"("id") ON DELETE CASCADE,
				CONSTRAINT "fk_chat_members_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
			)
		`);
		await queryRunner.query(`CREATE INDEX "idx_chat_members_user" ON "chat_members" ("user_id")`);
		await queryRunner.query(`
			CREATE TABLE "chat_messages" (
				"id" uuid NOT NULL,
				"conversation_id" uuid NOT NULL,
				"user_id" uuid,
				"kind" varchar(8) NOT NULL DEFAULT 'text',
				"body" varchar(2000) NOT NULL,
				"created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
				CONSTRAINT "pk_chat_messages" PRIMARY KEY ("id"),
				CONSTRAINT "fk_chat_messages_conversation" FOREIGN KEY ("conversation_id") REFERENCES "chat_conversations"("id") ON DELETE CASCADE,
				CONSTRAINT "fk_chat_messages_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL
			)
		`);
		await queryRunner.query(`CREATE INDEX "idx_chat_messages_conversation_created" ON "chat_messages" ("conversation_id", "created_at")`);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`DROP TABLE "chat_messages"`);
		await queryRunner.query(`DROP TABLE "chat_members"`);
		await queryRunner.query(`DROP TABLE "chat_conversations"`);
	}
}
