import type { MigrationInterface, QueryRunner } from "typeorm";

export class AddMediaItemLastSeenAt1793700000000 implements MigrationInterface {

	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`ALTER TABLE "media_items" ADD COLUMN IF NOT EXISTS "last_seen_at" TIMESTAMP WITH TIME ZONE`);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`ALTER TABLE "media_items" DROP COLUMN "last_seen_at"`);
	}
}
