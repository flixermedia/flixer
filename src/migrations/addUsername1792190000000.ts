import type { MigrationInterface, QueryRunner } from "typeorm";

export class AddUsername1792190000000 implements MigrationInterface {

	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query('ALTER TABLE "users" ADD COLUMN "username" character varying(64)');
		await queryRunner.query(`
      UPDATE "users"
      SET "username" = 'user_' || replace("id"::text, '-', '')
    `);
		await queryRunner.query('ALTER TABLE "users" ALTER COLUMN "username" SET NOT NULL');
		await queryRunner.query('ALTER TABLE "users" ALTER COLUMN "email" DROP NOT NULL');
		await queryRunner.query('ALTER TABLE "users" ADD CONSTRAINT "UQ_users_username" UNIQUE ("username")');
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query('ALTER TABLE "users" DROP CONSTRAINT "UQ_users_username"');
		await queryRunner.query('ALTER TABLE "users" ALTER COLUMN "email" SET NOT NULL');
		await queryRunner.query('ALTER TABLE "users" DROP COLUMN "username"');
	}
}
