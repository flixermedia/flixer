import type { MigrationInterface, QueryRunner } from "typeorm";

/** Requests moved to the flixer.requests plugin, which keeps its own tables; the core tables and settings are dropped. */
export class DropLegacyRequests1795200000000 implements MigrationInterface {
	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`DROP TABLE IF EXISTS "media_requests"`);
		await queryRunner.query(`DROP TABLE IF EXISTS "request_user_limits"`);
		await queryRunner.query(`DROP TABLE IF EXISTS "request_services"`);
		await queryRunner.query(`DELETE FROM "settings" WHERE "key" LIKE 'requests\\_%'`);
	}

	async down(): Promise<void> {
		// Intentionally irreversible: the legacy data is not preserved.
	}
}
