import type { MigrationInterface, QueryRunner } from "typeorm";

export class AddUserDisabledAt1793200000000 implements MigrationInterface {

	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query('ALTER TABLE "users" ADD "disabled_at" TIMESTAMP WITH TIME ZONE');
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query('ALTER TABLE "users" DROP COLUMN "disabled_at"');
	}
}
