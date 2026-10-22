import type { MigrationInterface, QueryRunner } from "typeorm";

export class AddMediaCreditPersonId1794000000000 implements MigrationInterface {

	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`ALTER TABLE "media_credits" ADD COLUMN "person_id" uuid`);
		await queryRunner.query(`UPDATE "media_credits" SET "person_id" = md5("person_key")::uuid`);
		await queryRunner.query(`ALTER TABLE "media_credits" ALTER COLUMN "person_id" SET NOT NULL`);
		await queryRunner.query(`CREATE INDEX "idx_media_credits_person_id" ON "media_credits" ("person_id")`);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`DROP INDEX "idx_media_credits_person_id"`);
		await queryRunner.query(`ALTER TABLE "media_credits" DROP COLUMN "person_id"`);
	}
}
