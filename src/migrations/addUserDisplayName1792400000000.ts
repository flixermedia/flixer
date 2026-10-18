import type { MigrationInterface, QueryRunner } from "typeorm";

export class AddUserDisplayName1792400000000 implements MigrationInterface {

	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query('ALTER TABLE "users" ADD COLUMN "display_name" character varying(64)');
		await queryRunner.query('UPDATE "users" SET "display_name" = "username"');
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query('ALTER TABLE "users" DROP COLUMN "display_name"');
	}
}
