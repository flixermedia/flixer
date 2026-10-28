import type { MigrationInterface, QueryRunner } from "typeorm";

export class AddFriendshipsAndProfileVisibility1795700000000 implements MigrationInterface {
	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(
			`ALTER TABLE "user_preferences" ADD COLUMN "profile_visibility" varchar(16) NOT NULL DEFAULT 'public'`,
		);
		await queryRunner.query(
			`UPDATE "user_preferences" SET "profile_visibility" = 'hidden' WHERE "profile_hidden" = true`,
		);
		await queryRunner.query(`ALTER TABLE "user_preferences" DROP COLUMN "profile_hidden"`);
		await queryRunner.query(`
			CREATE TABLE "social_friendships" (
				"user_low_id" uuid NOT NULL,
				"user_high_id" uuid NOT NULL,
				"requested_by" uuid NOT NULL,
				"created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
				"accepted_at" TIMESTAMP WITH TIME ZONE,
				CONSTRAINT "pk_social_friendships" PRIMARY KEY ("user_low_id", "user_high_id"),
				CONSTRAINT "fk_social_friendships_low" FOREIGN KEY ("user_low_id") REFERENCES "users"("id") ON DELETE CASCADE,
				CONSTRAINT "fk_social_friendships_high" FOREIGN KEY ("user_high_id") REFERENCES "users"("id") ON DELETE CASCADE,
				CONSTRAINT "fk_social_friendships_requester" FOREIGN KEY ("requested_by") REFERENCES "users"("id") ON DELETE CASCADE,
				CONSTRAINT "ck_social_friendships_order" CHECK ("user_low_id" < "user_high_id"),
				CONSTRAINT "ck_social_friendships_requester" CHECK ("requested_by" IN ("user_low_id", "user_high_id"))
			)
		`);
		await queryRunner.query(
			`CREATE INDEX "idx_social_friendships_high_pending" ON "social_friendships" ("user_high_id", "created_at") WHERE "accepted_at" IS NULL`,
		);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`DROP TABLE "social_friendships"`);
		await queryRunner.query(
			`ALTER TABLE "user_preferences" ADD COLUMN "profile_hidden" boolean NOT NULL DEFAULT false`,
		);
		await queryRunner.query(
			`UPDATE "user_preferences" SET "profile_hidden" = true WHERE "profile_visibility" = 'hidden'`,
		);
		await queryRunner.query(`ALTER TABLE "user_preferences" DROP COLUMN "profile_visibility"`);
	}
}
