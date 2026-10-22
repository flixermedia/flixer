import type { MigrationInterface, QueryRunner } from "typeorm";

export class AddMediaItemEditedFields1793500000000 implements MigrationInterface {

	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`ALTER TABLE "media_items" ADD COLUMN IF NOT EXISTS "edited_fields" jsonb NOT NULL DEFAULT '[]'`);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`ALTER TABLE "media_items" DROP COLUMN "edited_fields"`);
	}
}
