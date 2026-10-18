import type { MigrationInterface, QueryRunner } from "typeorm";

export class AddUserPasskeyRequired1792700000000 implements MigrationInterface {

	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query('ALTER TABLE "users" ADD COLUMN "passkey_required" boolean NOT NULL DEFAULT false');
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query('ALTER TABLE "users" DROP COLUMN "passkey_required"');
	}
}
