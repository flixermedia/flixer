import type { MigrationInterface, QueryRunner } from "typeorm";

export class CreateMediaOrganization1798300000032 implements MigrationInterface {

	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			CREATE TABLE "media_organization_settings" (
				"library_id" uuid NOT NULL,
				"templates" jsonb NOT NULL,
				"updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
				CONSTRAINT "PK_media_organization_settings" PRIMARY KEY ("library_id"),
				CONSTRAINT "FK_media_organization_settings_library" FOREIGN KEY ("library_id") REFERENCES "media_libraries"("id") ON DELETE CASCADE
			)
		`);
		await queryRunner.query(`
			CREATE TABLE "media_organization_plans" (
				"id" uuid NOT NULL,
				"library_id" uuid NOT NULL,
				"state" character varying(24) NOT NULL DEFAULT 'preview',
				"templates" jsonb NOT NULL,
				"moves" jsonb NOT NULL,
				"summary" jsonb NOT NULL,
				"created_by" uuid,
				"error" text,
				"executed_at" TIMESTAMP WITH TIME ZONE,
				"rolled_back_at" TIMESTAMP WITH TIME ZONE,
				"created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
				"updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
				CONSTRAINT "PK_media_organization_plans" PRIMARY KEY ("id"),
				CONSTRAINT "FK_media_organization_plans_library" FOREIGN KEY ("library_id") REFERENCES "media_libraries"("id") ON DELETE CASCADE
			)
		`);
		await queryRunner.query(`CREATE INDEX "IDX_media_organization_plans_library_created" ON "media_organization_plans" ("library_id", "created_at")`);
		await queryRunner.query(`
			CREATE TABLE "media_organization_plan_audit" (
				"id" uuid NOT NULL,
				"plan_id" uuid NOT NULL,
				"actor_id" uuid,
				"action" character varying(32) NOT NULL,
				"details" jsonb NOT NULL DEFAULT '{}',
				"created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
				CONSTRAINT "PK_media_organization_plan_audit" PRIMARY KEY ("id"),
				CONSTRAINT "FK_media_organization_plan_audit_plan" FOREIGN KEY ("plan_id") REFERENCES "media_organization_plans"("id") ON DELETE CASCADE
			)
		`);
		await queryRunner.query(`CREATE INDEX "IDX_media_organization_plan_audit_plan_created" ON "media_organization_plan_audit" ("plan_id", "created_at")`);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`DROP TABLE "media_organization_plan_audit"`);
		await queryRunner.query(`DROP TABLE "media_organization_plans"`);
		await queryRunner.query(`DROP TABLE "media_organization_settings"`);
	}
}
