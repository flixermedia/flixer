import type { MigrationInterface, QueryRunner } from "typeorm";

export class RemoveLegacySegmentSources1796000000000 implements MigrationInterface {
	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`DELETE FROM "media_segments" WHERE "source" NOT IN ('manual', 'theintrodb', 'plugin')`);
	}

	async down(): Promise<void> {}
}
