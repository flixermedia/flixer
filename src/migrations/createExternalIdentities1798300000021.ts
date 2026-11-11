import type { MigrationInterface, QueryRunner } from "typeorm";

export class CreateExternalIdentities1798300000021 implements MigrationInterface {
	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`CREATE TABLE "external_identities" (
			"plugin_id" varchar(128) NOT NULL,
			"identity_hash" varchar(64) NOT NULL,
			"user_id" uuid NOT NULL,
			"created_at" timestamptz NOT NULL DEFAULT now(),
			CONSTRAINT "PK_external_identities" PRIMARY KEY ("plugin_id", "identity_hash"),
			CONSTRAINT "FK_external_identities_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
		)`);
		await queryRunner.query('CREATE INDEX "IDX_external_identities_user" ON "external_identities" ("user_id")');
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query('DROP TABLE "external_identities"');
	}
}