import type { MigrationInterface, QueryRunner } from "typeorm";

/** Stores the empty-array default as a literal so it is comparable with the entity definition. */
export class AlignOidcResourceScopesDefault1798300000035 implements MigrationInterface {

	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`ALTER TABLE "oidc_clients" ALTER COLUMN "resource_scopes" SET DEFAULT '{}'::text[]`);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`ALTER TABLE "oidc_clients" ALTER COLUMN "resource_scopes" SET DEFAULT ARRAY[]::text[]`);
	}
}
