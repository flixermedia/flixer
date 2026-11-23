import type { MigrationInterface, QueryRunner } from "typeorm";

/** Repairs installations that recorded the initial invites migration before fulfillment and expiry columns were added. */
export class RepairInvitationUsages1798300000037 implements MigrationInterface {

	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`ALTER TABLE "invitation_usages" ADD COLUMN IF NOT EXISTS "pending_credentials" text`);
		await queryRunner.query(`ALTER TABLE "invitation_usages" ADD COLUMN IF NOT EXISTS "user_disabled_at" timestamptz`);
	}

	async down(): Promise<void> {
		// The original migration owns these columns and their data.
	}
}
