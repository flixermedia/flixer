import type { MigrationInterface, QueryRunner } from "typeorm";

export class RepairChatMlsDeviceApproval1797300000000 implements MigrationInterface {
	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`ALTER TABLE "chat_mls_devices" ADD COLUMN IF NOT EXISTS "approval_challenge" varchar(64)`);
		await queryRunner.query(`ALTER TABLE "chat_mls_devices" ADD COLUMN IF NOT EXISTS "revoked_at" TIMESTAMP WITH TIME ZONE`);
	}

	async down(): Promise<void> {}
}
