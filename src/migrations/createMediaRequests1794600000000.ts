import type { MigrationInterface, QueryRunner } from "typeorm";

export class CreateMediaRequests1794600000000 implements MigrationInterface {

	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			CREATE TABLE "request_services" (
				"id" uuid NOT NULL,
				"kind" varchar(16) NOT NULL,
				"name" varchar(100) NOT NULL,
				"url" text NOT NULL,
				"api_key" text NOT NULL,
				"is_default" boolean NOT NULL DEFAULT false,
				"enabled" boolean NOT NULL DEFAULT true,
				"root_folder" text NOT NULL,
				"quality_profile_id" integer NOT NULL,
				"metadata_profile_id" integer,
				"language_profile_id" integer,
				"minimum_availability" varchar(16),
				"season_folders" boolean NOT NULL DEFAULT true,
				"tags" jsonb NOT NULL DEFAULT '[]',
				"created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
				CONSTRAINT "pk_request_services" PRIMARY KEY ("id")
			)
		`);
		await queryRunner.query(`
			CREATE TABLE "media_requests" (
				"id" uuid NOT NULL,
				"user_id" uuid NOT NULL,
				"type" varchar(8) NOT NULL,
				"source" varchar(8) NOT NULL,
				"external_id" varchar(64) NOT NULL,
				"title" varchar(300) NOT NULL,
				"year" integer,
				"poster" text,
				"artist" varchar(300),
				"seasons" jsonb,
				"status" varchar(16) NOT NULL DEFAULT 'pending',
				"service_id" uuid,
				"quality_profile_id" integer,
				"root_folder" text,
				"decline_reason" varchar(500),
				"error" text,
				"processed_by" uuid,
				"created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
				"updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
				CONSTRAINT "pk_media_requests" PRIMARY KEY ("id"),
				CONSTRAINT "fk_media_requests_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,
				CONSTRAINT "fk_media_requests_service" FOREIGN KEY ("service_id") REFERENCES "request_services"("id") ON DELETE SET NULL
			)
		`);
		await queryRunner.query(
			`CREATE INDEX "idx_media_requests_user_created" ON "media_requests" ("user_id", "created_at")`,
		);
		await queryRunner.query(
			`CREATE INDEX "idx_media_requests_external" ON "media_requests" ("type", "external_id")`,
		);
		await queryRunner.query(
			`CREATE INDEX "idx_media_requests_status" ON "media_requests" ("status", "created_at")`,
		);
		await queryRunner.query(`
			CREATE TABLE "request_user_limits" (
				"user_id" uuid NOT NULL,
				"can_request" boolean,
				"auto_approve" boolean,
				"quota_limit" integer,
				"quota_days" integer,
				CONSTRAINT "pk_request_user_limits" PRIMARY KEY ("user_id"),
				CONSTRAINT "fk_request_user_limits_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
			)
		`);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`DROP TABLE "request_user_limits"`);
		await queryRunner.query(`DROP TABLE "media_requests"`);
		await queryRunner.query(`DROP TABLE "request_services"`);
	}
}
