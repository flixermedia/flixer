import type { MigrationInterface, QueryRunner } from "typeorm";

export class AddUserOriginalAccess1798100000000 implements MigrationInterface {

	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "original_access" varchar(8) NOT NULL DEFAULT 'inherit'`);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "original_access"`);
	}
}
