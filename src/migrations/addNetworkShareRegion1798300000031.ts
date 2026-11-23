import type { MigrationInterface, QueryRunner } from "typeorm";

export class AddNetworkShareRegion1798300000031 implements MigrationInterface {

	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`ALTER TABLE "network_shares" ADD COLUMN IF NOT EXISTS "region" character varying(64)`);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`ALTER TABLE "network_shares" DROP COLUMN IF EXISTS "region"`);
	}
}
