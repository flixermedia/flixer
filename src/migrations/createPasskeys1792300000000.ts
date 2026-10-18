import type { MigrationInterface, QueryRunner } from "typeorm";

export class CreatePasskeys1792300000000 implements MigrationInterface {

	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
      CREATE TABLE "passkey_credentials" (
        "id" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        "credential_id" character varying(1024) NOT NULL,
        "public_key" bytea NOT NULL,
        "counter" bigint NOT NULL DEFAULT 0,
        "transports" text,
        "device_type" character varying(32) NOT NULL,
        "backed_up" boolean NOT NULL DEFAULT false,
        "name" character varying(64) NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "last_used_at" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_passkey_credentials_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_passkey_credentials_credential_id" UNIQUE ("credential_id"),
        CONSTRAINT "FK_passkey_credentials_user_id" FOREIGN KEY ("user_id")
          REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION
      )
    `);
		await queryRunner.query('CREATE INDEX "IDX_passkey_credentials_user_id" ON "passkey_credentials" ("user_id")');
		await queryRunner.query(`
      CREATE TABLE "passkey_challenges" (
        "challenge" character varying(255) NOT NULL,
        "type" character varying(16) NOT NULL,
        "user_id" uuid,
        "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        CONSTRAINT "PK_passkey_challenges_challenge" PRIMARY KEY ("challenge")
      )
    `);
		await queryRunner.query('CREATE INDEX "IDX_passkey_challenges_expires_at" ON "passkey_challenges" ("expires_at")');
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query('DROP INDEX "IDX_passkey_challenges_expires_at"');
		await queryRunner.query('DROP TABLE "passkey_challenges"');
		await queryRunner.query('DROP INDEX "IDX_passkey_credentials_user_id"');
		await queryRunner.query('DROP TABLE "passkey_credentials"');
	}
}
