import type { MigrationInterface, QueryRunner } from "typeorm";

export class CreateUserAccessPolicies1798200000000 implements MigrationInterface {

	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			CREATE TABLE IF NOT EXISTS "user_access_policies" (
				"user_id" uuid PRIMARY KEY REFERENCES "users"("id") ON DELETE CASCADE,
				"library_mode" varchar(16) NOT NULL DEFAULT 'all',
				"library_ids" jsonb NOT NULL DEFAULT '[]',
				"max_age" integer,
				"block_unrated" boolean NOT NULL DEFAULT false,
				"allowed_tags" jsonb NOT NULL DEFAULT '[]',
				"blocked_tags" jsonb NOT NULL DEFAULT '[]',
				"schedule" jsonb,
				"pin_hash" varchar(160),
				"require_request_approval" boolean NOT NULL DEFAULT false,
				"updated_at" timestamptz NOT NULL DEFAULT now()
			)
		`);
		await queryRunner.query(`ALTER TABLE "user_sessions" ADD COLUMN IF NOT EXISTS "access_unlocked_until" timestamptz`);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`ALTER TABLE "user_sessions" DROP COLUMN IF EXISTS "access_unlocked_until"`);
		await queryRunner.query(`DROP TABLE IF EXISTS "user_access_policies"`);
	}
}
