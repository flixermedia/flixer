import type { MigrationInterface, QueryRunner } from "typeorm";

export class RepairChatMlsDevicePairingKey1797200000000 implements MigrationInterface {
	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`ALTER TABLE "chat_mls_devices" ADD COLUMN IF NOT EXISTS "pairing_public_key" text`);
	}

	async down(): Promise<void> {}
}
