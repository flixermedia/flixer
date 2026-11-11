import type { MigrationInterface, QueryRunner } from "typeorm";

export class CreateExternalAuthFlows1798300000022 implements MigrationInterface {
	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`CREATE TABLE "external_auth_flows" (
			"state_hash" varchar(64) PRIMARY KEY,
			"browser_hash" varchar(64) NOT NULL,
			"nonce_hash" varchar(64),
			"plugin_id" varchar(128) NOT NULL,
			"user_id" uuid,
			"verifier_cipher" text NOT NULL,
			"redirect_uri" text NOT NULL,
			"expires_at" timestamptz NOT NULL,
			CONSTRAINT "FK_external_auth_flows_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
		)`);
		await queryRunner.query('CREATE INDEX "IDX_external_auth_flows_expires" ON "external_auth_flows" ("expires_at")');
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query('DROP TABLE "external_auth_flows"');
	}
}