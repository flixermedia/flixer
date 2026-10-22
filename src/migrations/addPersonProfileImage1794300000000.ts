import type { MigrationInterface, QueryRunner } from "typeorm";

export class AddPersonProfileImage1794300000000 implements MigrationInterface {

	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`ALTER TABLE "person_profiles" ADD COLUMN "image" text`);
		// Profiles stored before Discogs was used for artists are looked up again.
		await queryRunner.query(`DELETE FROM "person_profiles"`);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`ALTER TABLE "person_profiles" DROP COLUMN "image"`);
	}
}
