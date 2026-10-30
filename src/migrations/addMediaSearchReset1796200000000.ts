import type { MigrationInterface, QueryRunner } from "typeorm";

export class AddMediaSearchReset1796200000000 implements MigrationInterface {

	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			ALTER TABLE "media_search_outbox"
			DROP CONSTRAINT "media_search_outbox_operation_check"
		`);
		await queryRunner.query(`
			ALTER TABLE "media_search_outbox"
			ADD CONSTRAINT "CHK_media_search_outbox_operation"
			CHECK ("operation" IN ('upsert', 'delete', 'rebuild', 'reset'))
		`);
		await queryRunner.query(`
			CREATE UNIQUE INDEX "UQ_media_search_outbox_reset"
			ON "media_search_outbox" ("operation")
			WHERE "operation" = 'reset'
		`);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`DELETE FROM "media_search_outbox" WHERE "operation" = 'reset'`);
		await queryRunner.query(`DROP INDEX "UQ_media_search_outbox_reset"`);
		await queryRunner.query(`
			ALTER TABLE "media_search_outbox"
			DROP CONSTRAINT "CHK_media_search_outbox_operation"
		`);
		await queryRunner.query(`
			ALTER TABLE "media_search_outbox"
			ADD CONSTRAINT "media_search_outbox_operation_check"
			CHECK ("operation" IN ('upsert', 'delete', 'rebuild'))
		`);
	}
}
