import type { MigrationInterface, QueryRunner } from "typeorm";

export class CreatePaymentSignups1798300000001 implements MigrationInterface {

	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`CREATE TABLE IF NOT EXISTS "payment_signups" (
			"user_id" uuid PRIMARY KEY,
			"created_at" timestamptz NOT NULL DEFAULT now()
		)`);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`DROP TABLE IF EXISTS "payment_signups"`);
	}
}
