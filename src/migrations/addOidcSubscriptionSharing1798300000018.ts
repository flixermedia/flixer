import type { MigrationInterface, QueryRunner } from "typeorm";

/** Controls whether an OAuth application may request subscription status. */
export class AddOidcSubscriptionSharing1798300000018 implements MigrationInterface {
	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`ALTER TABLE "oidc_clients" ADD COLUMN "share_subscription" boolean NOT NULL DEFAULT false`);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`ALTER TABLE "oidc_clients" DROP COLUMN "share_subscription"`);
	}
}
