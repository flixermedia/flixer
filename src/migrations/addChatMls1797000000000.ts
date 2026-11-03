import type { MigrationInterface, QueryRunner } from "typeorm";

export class AddChatMls1797000000000 implements MigrationInterface {
	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`ALTER TABLE "chat_messages" ALTER COLUMN "body" TYPE text`);
		await queryRunner.query(`ALTER TABLE "chat_messages" ADD COLUMN "sequence" bigserial NOT NULL`);
		await queryRunner.query(`CREATE INDEX "idx_chat_messages_conversation_sequence" ON "chat_messages" ("conversation_id", "sequence")`);
		await queryRunner.query(`
			CREATE TABLE "chat_mls_devices" (
				"id" uuid NOT NULL,
				"user_id" uuid NOT NULL,
				"name" varchar(80) NOT NULL,
				"status" varchar(12) NOT NULL DEFAULT 'pending',
				"pairing_public_key" text NOT NULL,
				"approval_challenge" varchar(64),
				"created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
				"approved_at" TIMESTAMP WITH TIME ZONE,
				"revoked_at" TIMESTAMP WITH TIME ZONE,
				CONSTRAINT "pk_chat_mls_devices" PRIMARY KEY ("id"),
				CONSTRAINT "uq_chat_mls_devices_user_id" UNIQUE ("user_id", "id"),
				CONSTRAINT "ck_chat_mls_devices_status" CHECK ("status" IN ('pending', 'active', 'revoked')),
				CONSTRAINT "fk_chat_mls_devices_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
			)
		`);
		await queryRunner.query(`CREATE INDEX "idx_chat_mls_devices_user_status" ON "chat_mls_devices" ("user_id", "status")`);
		await queryRunner.query(`
			CREATE TABLE "chat_mls_key_packages" (
				"id" uuid NOT NULL,
				"device_id" uuid NOT NULL,
				"key_package" text NOT NULL,
				"created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
				"used_at" TIMESTAMP WITH TIME ZONE,
				CONSTRAINT "pk_chat_mls_key_packages" PRIMARY KEY ("id"),
				CONSTRAINT "fk_chat_mls_key_packages_device" FOREIGN KEY ("device_id") REFERENCES "chat_mls_devices"("id") ON DELETE CASCADE
			)
		`);
		await queryRunner.query(`CREATE INDEX "idx_chat_mls_key_packages_available" ON "chat_mls_key_packages" ("device_id", "created_at") WHERE "used_at" IS NULL`);
		await queryRunner.query(`
			CREATE TABLE "chat_mls_welcomes" (
				"id" uuid NOT NULL,
				"conversation_id" uuid NOT NULL,
				"device_id" uuid NOT NULL,
				"key_package_id" uuid NOT NULL,
				"message_id" uuid NOT NULL,
				"welcome" text NOT NULL,
				"ratchet_tree" text NOT NULL,
				"created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
				"consumed_at" TIMESTAMP WITH TIME ZONE,
				CONSTRAINT "pk_chat_mls_welcomes" PRIMARY KEY ("id"),
				CONSTRAINT "fk_chat_mls_welcomes_conversation" FOREIGN KEY ("conversation_id") REFERENCES "chat_conversations"("id") ON DELETE CASCADE,
				CONSTRAINT "fk_chat_mls_welcomes_device" FOREIGN KEY ("device_id") REFERENCES "chat_mls_devices"("id") ON DELETE CASCADE,
				CONSTRAINT "fk_chat_mls_welcomes_key_package" FOREIGN KEY ("key_package_id") REFERENCES "chat_mls_key_packages"("id") ON DELETE CASCADE,
				CONSTRAINT "fk_chat_mls_welcomes_message" FOREIGN KEY ("message_id") REFERENCES "chat_messages"("id") ON DELETE CASCADE,
				CONSTRAINT "uq_chat_mls_welcomes_key_package" UNIQUE ("conversation_id", "key_package_id")
			)
		`);
		await queryRunner.query(`CREATE INDEX "idx_chat_mls_welcomes_device" ON "chat_mls_welcomes" ("device_id", "created_at") WHERE "consumed_at" IS NULL`);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			DO $$
			BEGIN
				IF EXISTS (SELECT 1 FROM "chat_messages" WHERE length("body") > 2000) THEN
					RAISE EXCEPTION 'Cannot revert chat MLS migration while messages exceed the legacy 2000-character limit.';
				END IF;
			END
			$$
		`);
		await queryRunner.query(`DROP TABLE "chat_mls_welcomes"`);
		await queryRunner.query(`DROP TABLE "chat_mls_key_packages"`);
		await queryRunner.query(`DROP TABLE "chat_mls_devices"`);
		await queryRunner.query(`DROP INDEX "idx_chat_messages_conversation_sequence"`);
		await queryRunner.query(`ALTER TABLE "chat_messages" DROP COLUMN "sequence"`);
		await queryRunner.query(`ALTER TABLE "chat_messages" ALTER COLUMN "body" TYPE varchar(2000)`);
	}
}
