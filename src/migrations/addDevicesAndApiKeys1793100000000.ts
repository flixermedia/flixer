import type { MigrationInterface, QueryRunner } from "typeorm";

export class AddDevicesAndApiKeys1793100000000 implements MigrationInterface {

	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query('ALTER TABLE "user_sessions" ADD "user_agent" character varying(512)');
		await queryRunner.query('ALTER TABLE "user_sessions" ADD "ip_address" character varying(64)');
		await queryRunner.query('ALTER TABLE "user_sessions" ADD "last_seen_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()');
		await queryRunner.query(`
      CREATE TABLE "api_keys" (
        "id" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        "name" character varying(100) NOT NULL,
        "prefix" character varying(16) NOT NULL,
        "key_hash" character varying(64) NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "last_used_at" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_api_keys_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_api_keys_key_hash" UNIQUE ("key_hash"),
        CONSTRAINT "FK_api_keys_user_id" FOREIGN KEY ("user_id")
          REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION
      )
    `);
		await queryRunner.query('CREATE INDEX "IDX_api_keys_user_id" ON "api_keys" ("user_id")');
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query('DROP INDEX "IDX_api_keys_user_id"');
		await queryRunner.query('DROP TABLE "api_keys"');
		await queryRunner.query('ALTER TABLE "user_sessions" DROP COLUMN "last_seen_at"');
		await queryRunner.query('ALTER TABLE "user_sessions" DROP COLUMN "ip_address"');
		await queryRunner.query('ALTER TABLE "user_sessions" DROP COLUMN "user_agent"');
	}
}
