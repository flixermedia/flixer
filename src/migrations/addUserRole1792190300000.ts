import type { MigrationInterface, QueryRunner } from "typeorm";

export class AddUserRole1792190300000 implements MigrationInterface {

	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(
			'ALTER TABLE "users" ADD COLUMN "role" character varying(16) NOT NULL DEFAULT \'user\'',
		);
		await queryRunner.query(`
      ALTER TABLE "users"
      ADD CONSTRAINT "CHK_users_role" CHECK ("role" IN ('admin', 'user'))
    `);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query('ALTER TABLE "users" DROP CONSTRAINT "CHK_users_role"');
		await queryRunner.query('ALTER TABLE "users" DROP COLUMN "role"');
	}
}
