import type { MigrationInterface, QueryRunner } from "typeorm";

/** Moves passkey_required and avatar_file from users into user_preferences. */
export class MoveUserSettingsToPreferences1793000000000 implements MigrationInterface {

	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query('ALTER TABLE "user_preferences" ADD COLUMN "passkey_required" boolean NOT NULL DEFAULT false');
		await queryRunner.query('ALTER TABLE "user_preferences" ADD COLUMN "avatar_file" varchar(128)');
		await queryRunner.query(`
      INSERT INTO "user_preferences" ("user_id", "passkey_required", "avatar_file")
      SELECT "id", "passkey_required", "avatar_file" FROM "users"
      WHERE "passkey_required" = true OR "avatar_file" IS NOT NULL
      ON CONFLICT ("user_id") DO UPDATE
        SET "passkey_required" = EXCLUDED."passkey_required", "avatar_file" = EXCLUDED."avatar_file"
    `);
		await queryRunner.query('ALTER TABLE "users" DROP COLUMN "passkey_required"');
		await queryRunner.query('ALTER TABLE "users" DROP COLUMN "avatar_file"');
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query('ALTER TABLE "users" ADD COLUMN "passkey_required" boolean NOT NULL DEFAULT false');
		await queryRunner.query('ALTER TABLE "users" ADD COLUMN "avatar_file" varchar(128)');
		await queryRunner.query(`
      UPDATE "users" SET "passkey_required" = p."passkey_required", "avatar_file" = p."avatar_file"
      FROM "user_preferences" p WHERE p."user_id" = "users"."id"
    `);
		await queryRunner.query('ALTER TABLE "user_preferences" DROP COLUMN "avatar_file"');
		await queryRunner.query('ALTER TABLE "user_preferences" DROP COLUMN "passkey_required"');
	}
}
