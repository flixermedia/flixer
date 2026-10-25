import type { MigrationInterface, QueryRunner } from "typeorm";

export class AddRequestServiceLibrary1794700000000 implements MigrationInterface {

	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`ALTER TABLE "request_services" ADD COLUMN "library_id" uuid`);
		await queryRunner.query(
			`ALTER TABLE "request_services" ADD CONSTRAINT "fk_request_services_library" FOREIGN KEY ("library_id") REFERENCES "media_libraries"("id") ON DELETE SET NULL`,
		);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`ALTER TABLE "request_services" DROP CONSTRAINT "fk_request_services_library"`);
		await queryRunner.query(`ALTER TABLE "request_services" DROP COLUMN "library_id"`);
	}
}
