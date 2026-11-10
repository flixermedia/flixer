import type { MigrationInterface, QueryRunner } from "typeorm";

/** Persistent client registrations and short-lived provider artifacts. */
export class CreateOidcProvider1798300000015 implements MigrationInterface {
	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			CREATE TABLE "oidc_clients" (
				"id" varchar(64) PRIMARY KEY,
				"name" varchar(100) NOT NULL,
				"redirect_uris" jsonb NOT NULL,
				"secret_encrypted" text,
				"created_at" timestamptz NOT NULL DEFAULT now()
			)
		`);
		await queryRunner.query(`
			CREATE TABLE "oidc_artifacts" (
				"kind" varchar(64) NOT NULL,
				"id" varchar(255) NOT NULL,
				"payload" jsonb NOT NULL,
				"expires_at" timestamptz,
				PRIMARY KEY ("kind", "id")
			)
		`);
		await queryRunner.query(`CREATE TABLE "oidc_config" ("key" varchar(64) PRIMARY KEY, "value" text NOT NULL)`);
		await queryRunner.query(`CREATE INDEX "IDX_oidc_artifacts_expiry" ON "oidc_artifacts" ("expires_at")`);
		await queryRunner.query(`CREATE INDEX "IDX_oidc_artifacts_grant" ON "oidc_artifacts" (("payload"->>'grantId'))`);
		await queryRunner.query(`CREATE INDEX "IDX_oidc_artifacts_uid" ON "oidc_artifacts" (("payload"->>'uid'))`);
		await queryRunner.query(`CREATE INDEX "IDX_oidc_artifacts_user_code" ON "oidc_artifacts" (("payload"->>'userCode'))`);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`DROP TABLE "oidc_config"`);
		await queryRunner.query(`DROP TABLE "oidc_artifacts"`);
		await queryRunner.query(`DROP TABLE "oidc_clients"`);
	}
}
