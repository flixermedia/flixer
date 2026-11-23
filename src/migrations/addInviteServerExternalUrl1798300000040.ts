import type { MigrationInterface, QueryRunner } from "typeorm";

/** Adds an optional public/external URL to invite servers so invited users can be directed separately from the backend API URL. */
export class AddInviteServerExternalUrl1798300000040 implements MigrationInterface {
	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`ALTER TABLE "invite_servers" ADD COLUMN IF NOT EXISTS "external_url" character varying(500)`);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`ALTER TABLE "invite_servers" DROP COLUMN IF EXISTS "external_url"`);
	}
}
