import type { MigrationInterface, QueryRunner } from "typeorm";

/** Adds per-invitation email verification override and widens usage status for pending_verification. */
export class AddInviteEmailVerificationControl1798300000038 implements MigrationInterface {
	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`ALTER TABLE "invitations" ADD COLUMN IF NOT EXISTS "skip_email_verification" boolean NOT NULL DEFAULT false`);
		await queryRunner.query(`ALTER TABLE "invitation_usages" ALTER COLUMN "status" TYPE varchar(32)`);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`ALTER TABLE "invitations" DROP COLUMN IF EXISTS "skip_email_verification"`);
	}
}
