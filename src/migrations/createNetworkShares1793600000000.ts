import type { MigrationInterface, QueryRunner } from "typeorm";

export class CreateNetworkShares1793600000000 implements MigrationInterface {

	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "network_shares" (
        "id" uuid NOT NULL,
        "name" character varying(100) NOT NULL,
        "protocol" character varying(8) NOT NULL DEFAULT 'smb',
        "host" character varying(255) NOT NULL,
        "share" character varying(255) NOT NULL,
        "username" character varying(255),
        "domain" character varying(64),
        "password_encrypted" text,
        "read_only" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_network_shares" PRIMARY KEY ("id")
      )
    `);
		await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "UQ_network_shares_name" ON "network_shares" ("name")`);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`DROP TABLE "network_shares"`);
	}
}
