import type { MigrationInterface, QueryRunner } from "typeorm";

export class CreateQuickConnectRequests1798300000012 implements MigrationInterface {

	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			CREATE TABLE "quick_connect_requests" (
				"id" uuid NOT NULL,
				"user_code_hash" character varying(64) NOT NULL,
				"poll_token_hash" character varying(64) NOT NULL,
				"status" character varying(12) NOT NULL DEFAULT 'pending',
				"user_id" uuid,
				"created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
				"expires_at" TIMESTAMP WITH TIME ZONE NOT NULL,
				CONSTRAINT "PK_quick_connect_requests_id" PRIMARY KEY ("id"),
				CONSTRAINT "UQ_quick_connect_requests_user_code_hash" UNIQUE ("user_code_hash"),
				CONSTRAINT "FK_quick_connect_requests_user_id" FOREIGN KEY ("user_id")
					REFERENCES "users"("id") ON DELETE CASCADE,
				CONSTRAINT "CK_quick_connect_requests_status"
					CHECK ("status" IN ('pending', 'approved', 'denied'))
			)
		`);
		await queryRunner.query('CREATE INDEX "IDX_quick_connect_requests_expires_at" ON "quick_connect_requests" ("expires_at")');
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query('DROP INDEX "IDX_quick_connect_requests_expires_at"');
		await queryRunner.query('DROP TABLE "quick_connect_requests"');
	}
}
