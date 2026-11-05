import type { MigrationInterface, QueryRunner } from "typeorm";

export class AddPaymentProductRequiresPurchase1798300000002 implements MigrationInterface {

	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`ALTER TABLE "payment_products" ADD COLUMN IF NOT EXISTS "requires_purchase" boolean NOT NULL DEFAULT false`);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`ALTER TABLE "payment_products" DROP COLUMN IF EXISTS "requires_purchase"`);
	}
}
