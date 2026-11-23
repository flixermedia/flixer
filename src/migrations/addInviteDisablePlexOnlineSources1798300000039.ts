import type { MigrationInterface, QueryRunner } from "typeorm";

/** Adds the per-invitation toggle to opt invited Plex accounts out of Plex online media sources. */
export class AddInviteDisablePlexOnlineSources1798300000039 implements MigrationInterface {

	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`ALTER TABLE "invitations" ADD COLUMN IF NOT EXISTS "disable_plex_online_sources" boolean NOT NULL DEFAULT false`);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`ALTER TABLE "invitations" DROP COLUMN IF EXISTS "disable_plex_online_sources"`);
	}
}
