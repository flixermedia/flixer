import type { MigrationInterface, QueryRunner } from "typeorm";

export class CreateNativePasskeyHandoffs1795600000000 implements MigrationInterface {

	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
      CREATE TABLE "native_passkey_handoffs" (
        "id_hash" character varying(64) NOT NULL,
        "code_hash" character varying(64),
        "code_challenge" character varying(43) NOT NULL,
        "state" character varying(64) NOT NULL,
        "user_id" uuid,
        "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        CONSTRAINT "PK_native_passkey_handoffs_id_hash" PRIMARY KEY ("id_hash"),
        CONSTRAINT "UQ_native_passkey_handoffs_code_hash" UNIQUE ("code_hash"),
        CONSTRAINT "FK_native_passkey_handoffs_user_id" FOREIGN KEY ("user_id")
          REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION
      )
    `);
		await queryRunner.query(
			'CREATE INDEX "IDX_native_passkey_handoffs_expires_at" ON "native_passkey_handoffs" ("expires_at")',
		);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query('DROP INDEX "IDX_native_passkey_handoffs_expires_at"');
		await queryRunner.query('DROP TABLE "native_passkey_handoffs"');
	}
}
