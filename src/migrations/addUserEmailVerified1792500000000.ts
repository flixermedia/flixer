import type { MigrationInterface, QueryRunner } from "typeorm";

export class AddUserEmailVerified1792500000000 implements MigrationInterface {

	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query('ALTER TABLE "users" ADD COLUMN "email_verified_at" timestamp with time zone');
		// Accounts created before verification existed are treated as verified.
		await queryRunner.query('UPDATE "users" SET "email_verified_at" = "created_at"');
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query('ALTER TABLE "users" DROP COLUMN "email_verified_at"');
	}
}
