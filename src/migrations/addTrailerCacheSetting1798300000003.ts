import type { MigrationInterface, QueryRunner } from "typeorm";

export class AddTrailerCacheSetting1798300000003 implements MigrationInterface {
	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			INSERT INTO "settings" ("key", "value", "is_public")
			VALUES ('trailers_cache_enabled', 'false'::jsonb, false)
			ON CONFLICT ("key") DO NOTHING
		`);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`DELETE FROM "settings" WHERE "key" = 'trailers_cache_enabled'`);
	}
}
