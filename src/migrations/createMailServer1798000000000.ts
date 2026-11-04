import type { MigrationInterface, QueryRunner } from "typeorm";

export class CreateMailServer1798000000000 implements MigrationInterface {
	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			CREATE TABLE IF NOT EXISTS "mail_server_settings" (
				"id" smallint NOT NULL DEFAULT 1,
				"inbound_enabled" boolean NOT NULL DEFAULT false,
				"inbound_port" integer NOT NULL DEFAULT 2525,
				"hostname" character varying(253),
				"max_message_mb" integer NOT NULL DEFAULT 10,
				"outbound_enabled" boolean NOT NULL DEFAULT false,
				"relay_fallback" boolean NOT NULL DEFAULT false,
				"noreply_address" character varying(320),
				"noreply_name" character varying(100) NOT NULL DEFAULT 'Flixer',
				"user_addresses_enabled" boolean NOT NULL DEFAULT false,
				"user_address_mode" character varying(8) NOT NULL DEFAULT 'username',
				"user_address_domain" character varying(253),
				"updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
				CONSTRAINT "pk_mail_server_settings" PRIMARY KEY ("id"),
				CONSTRAINT "chk_mail_server_settings_singleton" CHECK ("id" = 1),
				CONSTRAINT "chk_mail_server_settings_port" CHECK ("inbound_port" BETWEEN 1 AND 65535),
				CONSTRAINT "chk_mail_server_settings_size" CHECK ("max_message_mb" BETWEEN 1 AND 50),
				CONSTRAINT "chk_mail_server_settings_mode" CHECK ("user_address_mode" IN ('username', 'random'))
			)
		`);
		await queryRunner.query(`INSERT INTO "mail_server_settings" ("id") VALUES (1) ON CONFLICT ("id") DO NOTHING`);
		await queryRunner.query(`
			CREATE TABLE IF NOT EXISTS "mail_domains" (
				"id" uuid NOT NULL,
				"domain" character varying(253) NOT NULL,
				"allow_subdomains" boolean NOT NULL DEFAULT false,
				"verification_token" character varying(64) NOT NULL,
				"verified_at" TIMESTAMP WITH TIME ZONE,
				"dkim_selector" character varying(63) NOT NULL,
				"dkim_public_key" text NOT NULL,
				"dkim_private_key" text NOT NULL,
				"dns_checks" jsonb NOT NULL DEFAULT '{}',
				"last_checked_at" TIMESTAMP WITH TIME ZONE,
				"created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
				"updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
				CONSTRAINT "pk_mail_domains" PRIMARY KEY ("id"),
				CONSTRAINT "uq_mail_domains_domain" UNIQUE ("domain")
			)
		`);
		await queryRunner.query(`
			CREATE TABLE IF NOT EXISTS "mailboxes" (
				"id" uuid NOT NULL,
				"address" character varying(320) NOT NULL,
				"kind" character varying(8) NOT NULL,
				"display_name" character varying(100),
				"user_id" uuid,
				"enabled" boolean NOT NULL DEFAULT true,
				"created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
				CONSTRAINT "pk_mailboxes" PRIMARY KEY ("id"),
				CONSTRAINT "uq_mailboxes_address" UNIQUE ("address"),
				CONSTRAINT "chk_mailboxes_kind" CHECK ("kind" IN ('system', 'inbox', 'user')),
				CONSTRAINT "fk_mailboxes_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
			)
		`);
		await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "uq_mailboxes_user" ON "mailboxes" ("user_id") WHERE "user_id" IS NOT NULL`);
		await queryRunner.query(`
			CREATE TABLE IF NOT EXISTS "mail_messages" (
				"id" uuid NOT NULL,
				"mailbox_id" uuid,
				"direction" character varying(8) NOT NULL,
				"status" character varying(8) NOT NULL,
				"from_address" character varying(320) NOT NULL,
				"from_name" character varying(200),
				"to_addresses" jsonb NOT NULL DEFAULT '[]',
				"subject" character varying(998) NOT NULL DEFAULT '',
				"text" text NOT NULL DEFAULT '',
				"html" text,
				"message_id" character varying(998),
				"in_reply_to" character varying(998),
				"is_system" boolean NOT NULL DEFAULT false,
				"attachments" jsonb NOT NULL DEFAULT '[]',
				"auth_results" jsonb,
				"remote_address" character varying(64),
				"attempts" integer NOT NULL DEFAULT 0,
				"next_attempt_at" TIMESTAMP WITH TIME ZONE,
				"last_error" text,
				"sent_at" TIMESTAMP WITH TIME ZONE,
				"read_at" TIMESTAMP WITH TIME ZONE,
				"created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
				CONSTRAINT "pk_mail_messages" PRIMARY KEY ("id"),
				CONSTRAINT "chk_mail_messages_direction" CHECK ("direction" IN ('inbound', 'outbound')),
				CONSTRAINT "chk_mail_messages_status" CHECK ("status" IN ('received', 'queued', 'sent', 'failed')),
				CONSTRAINT "fk_mail_messages_mailbox" FOREIGN KEY ("mailbox_id") REFERENCES "mailboxes"("id") ON DELETE CASCADE
			)
		`);
		// Databases that ran an earlier draft of this migration lack these columns.
		await queryRunner.query(`ALTER TABLE "mail_messages" ADD COLUMN IF NOT EXISTS "in_reply_to" character varying(998)`);
		await queryRunner.query(`ALTER TABLE "mail_messages" ADD COLUMN IF NOT EXISTS "is_system" boolean NOT NULL DEFAULT false`);
		await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_mail_messages_mailbox_created" ON "mail_messages" ("mailbox_id", "created_at")`);
		await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_mail_messages_status_next" ON "mail_messages" ("status", "next_attempt_at")`);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`DROP TABLE IF EXISTS "mail_messages"`);
		await queryRunner.query(`DROP TABLE IF EXISTS "mailboxes"`);
		await queryRunner.query(`DROP TABLE IF EXISTS "mail_domains"`);
		await queryRunner.query(`DROP TABLE IF EXISTS "mail_server_settings"`);
	}
}
