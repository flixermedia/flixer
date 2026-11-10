import type { MigrationInterface, QueryRunner } from "typeorm";

/** Allows administrators to approve resource permissions separately for each client. */
export class AddOidcResourceScopes1798300000019 implements MigrationInterface {
	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`ALTER TABLE "oidc_clients" ADD COLUMN "resource_scopes" text[] NOT NULL DEFAULT ARRAY[]::text[]`);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`ALTER TABLE "oidc_clients" DROP COLUMN "resource_scopes"`);
	}
}
