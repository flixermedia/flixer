import type { MigrationInterface, QueryRunner } from "typeorm";

export class CreatePersonProfiles1794200000000 implements MigrationInterface {

	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			CREATE TABLE "person_profiles" (
				"person_id" uuid NOT NULL,
				"description" text,
				"biography" text,
				"source" text,
				"source_url" text,
				"fetched_at" timestamptz NOT NULL,
				CONSTRAINT "pk_person_profiles" PRIMARY KEY ("person_id")
			)
		`);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`DROP TABLE "person_profiles"`);
	}
}
