import type { MigrationInterface, QueryRunner } from "typeorm";

export class AddUserPendingEmail1792600000000 implements MigrationInterface {

	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query('ALTER TABLE "users" ADD COLUMN "pending_email" character varying(254)');
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query('ALTER TABLE "users" DROP COLUMN "pending_email"');
	}
}
