import type { MigrationInterface, QueryRunner } from "typeorm";

export class CreateUserPreferences1792900000000 implements MigrationInterface {

	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
      CREATE TABLE "user_preferences" (
        "user_id" uuid NOT NULL,
        "data" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_user_preferences_user_id" PRIMARY KEY ("user_id"),
        CONSTRAINT "FK_user_preferences_user_id" FOREIGN KEY ("user_id")
          REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION
      )
    `);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query('DROP TABLE "user_preferences"');
	}
}
