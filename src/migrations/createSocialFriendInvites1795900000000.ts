import type { MigrationInterface, QueryRunner } from "typeorm";

export class CreateSocialFriendInvites1795900000000 implements MigrationInterface {
	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			CREATE TABLE "social_friend_invites" (
				"token" varchar(36) NOT NULL,
				"owner_id" uuid NOT NULL,
				"max_uses" integer,
				"use_count" integer NOT NULL DEFAULT 0,
				"expires_at" TIMESTAMP WITH TIME ZONE,
				"created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
				CONSTRAINT "pk_social_friend_invites" PRIMARY KEY ("token"),
				CONSTRAINT "fk_social_friend_invites_owner" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE,
				CONSTRAINT "ck_social_friend_invites_max_uses" CHECK ("max_uses" IS NULL OR "max_uses" > 0),
				CONSTRAINT "ck_social_friend_invites_use_count" CHECK ("use_count" >= 0)
			)
		`);
		await queryRunner.query(`
			INSERT INTO "social_friend_invites" ("token", "owner_id", "max_uses")
			SELECT "friend_invite_token", "user_id", 1
			FROM "user_preferences"
			WHERE "friend_invite_token" IS NOT NULL
		`);
		await queryRunner.query(`DROP INDEX "uq_user_preferences_friend_invite_token"`);
		await queryRunner.query(`ALTER TABLE "user_preferences" DROP COLUMN "friend_invite_token"`);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`ALTER TABLE "user_preferences" ADD COLUMN "friend_invite_token" varchar(36)`);
		await queryRunner.query(`
			UPDATE "user_preferences" up
			SET "friend_invite_token" = (
				SELECT invite."token" FROM "social_friend_invites" invite
				WHERE invite."owner_id" = up."user_id"
				ORDER BY invite."created_at" DESC LIMIT 1
			)
		`);
		await queryRunner.query(
			`CREATE UNIQUE INDEX "uq_user_preferences_friend_invite_token" ON "user_preferences" ("friend_invite_token") WHERE "friend_invite_token" IS NOT NULL`,
		);
		await queryRunner.query(`DROP TABLE "social_friend_invites"`);
	}
}
