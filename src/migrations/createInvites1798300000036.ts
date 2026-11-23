import type { MigrationInterface, QueryRunner } from "typeorm";

export class CreateInvites1798300000036 implements MigrationInterface {
	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`CREATE TABLE "invite_servers" (
			"id" uuid NOT NULL,
			"name" varchar(100) NOT NULL,
			"type" varchar(16) NOT NULL,
			"url" varchar(500) NOT NULL,
			"api_key_encrypted" text,
			"instructions" text,
			"enabled" boolean NOT NULL DEFAULT true,
			"created_at" timestamptz NOT NULL DEFAULT now(),
			"updated_at" timestamptz NOT NULL DEFAULT now(),
			CONSTRAINT "PK_invite_servers" PRIMARY KEY ("id")
		)`);
		await queryRunner.query('CREATE UNIQUE INDEX "UQ_invite_servers_name" ON "invite_servers" ("name")');
		await queryRunner.query(`CREATE TABLE "invitations" (
			"id" uuid NOT NULL,
			"code" varchar(64) NOT NULL,
			"label" varchar(100),
			"server_id" uuid,
			"max_uses" int,
			"used_count" int NOT NULL DEFAULT 0,
			"expires_at" timestamptz,
			"disabled" boolean NOT NULL DEFAULT false,
			"library_mode" varchar(16) NOT NULL DEFAULT 'all',
			"library_ids" jsonb NOT NULL DEFAULT '[]',
			"external_library_ids" jsonb NOT NULL DEFAULT '[]',
			"allow_downloads" boolean NOT NULL DEFAULT true,
			"skip_payment" boolean NOT NULL DEFAULT false,
			"skip_email_verification" boolean NOT NULL DEFAULT false,
			"disable_plex_online_sources" boolean NOT NULL DEFAULT false,
			"user_expires_in_days" int,
			"created_by" uuid,
			"created_at" timestamptz NOT NULL DEFAULT now(),
			"updated_at" timestamptz NOT NULL DEFAULT now(),
			CONSTRAINT "PK_invitations" PRIMARY KEY ("id"),
			CONSTRAINT "FK_invitations_server" FOREIGN KEY ("server_id") REFERENCES "invite_servers"("id") ON DELETE CASCADE,
			CONSTRAINT "FK_invitations_created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL
		)`);
		await queryRunner.query('CREATE UNIQUE INDEX "UQ_invitations_code" ON "invitations" ("code")');
		await queryRunner.query(`CREATE TABLE "invitation_usages" (
			"id" uuid NOT NULL,
			"invitation_id" uuid NOT NULL,
			"user_id" uuid,
			"username" varchar(64) NOT NULL,
			"status" varchar(32) NOT NULL DEFAULT 'completed',
			"external_user_id" varchar(128),
			"external_email" varchar(254),
			"error" text,
			"pending_credentials" text,
			"expires_at" timestamptz,
			"user_disabled_at" timestamptz,
			"created_at" timestamptz NOT NULL DEFAULT now(),
			CONSTRAINT "PK_invitation_usages" PRIMARY KEY ("id"),
			CONSTRAINT "FK_invitation_usages_invitation" FOREIGN KEY ("invitation_id") REFERENCES "invitations"("id") ON DELETE CASCADE,
			CONSTRAINT "FK_invitation_usages_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL
		)`);
		await queryRunner.query('CREATE INDEX "IDX_invitation_usages_invitation" ON "invitation_usages" ("invitation_id")');
		await queryRunner.query('CREATE INDEX "IDX_invitation_usages_user" ON "invitation_usages" ("user_id")');
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query('DROP TABLE "invitation_usages"');
		await queryRunner.query('DROP TABLE "invitations"');
		await queryRunner.query('DROP TABLE "invite_servers"');
	}
}
