import type { MigrationInterface, QueryRunner } from "typeorm";

export class AddFriendInviteTokens1795800000000 implements MigrationInterface {
	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`ALTER TABLE "user_preferences" ADD COLUMN "friend_invite_token" varchar(36)`);
		await queryRunner.query(
			`CREATE UNIQUE INDEX "uq_user_preferences_friend_invite_token" ON "user_preferences" ("friend_invite_token") WHERE "friend_invite_token" IS NOT NULL`,
		);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`DROP INDEX "uq_user_preferences_friend_invite_token"`);
		await queryRunner.query(`ALTER TABLE "user_preferences" DROP COLUMN "friend_invite_token"`);
	}
}
