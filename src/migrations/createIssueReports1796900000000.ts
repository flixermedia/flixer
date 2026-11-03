import type { MigrationInterface, QueryRunner } from "typeorm";

export class CreateIssueReports1796900000000 implements MigrationInterface {
	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			CREATE TABLE "issue_reports" (
				"id" uuid NOT NULL,
				"user_id" uuid NOT NULL,
				"media_item_id" uuid,
				"media_title" varchar(300),
				"title" varchar(200) NOT NULL,
				"category" varchar(60) NOT NULL,
				"description" text NOT NULL,
				"status" varchar(16) NOT NULL DEFAULT 'open',
				"conversation_id" uuid,
				"chat_open" boolean NOT NULL DEFAULT false,
				"created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
				"updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
				"resolved_at" TIMESTAMP WITH TIME ZONE,
				CONSTRAINT "pk_issue_reports" PRIMARY KEY ("id"),
				CONSTRAINT "ck_issue_reports_status" CHECK ("status" IN ('open', 'in_progress', 'resolved', 'closed')),
				CONSTRAINT "fk_issue_reports_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,
				CONSTRAINT "fk_issue_reports_media" FOREIGN KEY ("media_item_id") REFERENCES "media_items"("id") ON DELETE SET NULL,
				CONSTRAINT "fk_issue_reports_conversation" FOREIGN KEY ("conversation_id") REFERENCES "chat_conversations"("id") ON DELETE SET NULL
			)
		`);
		await queryRunner.query(`CREATE INDEX "idx_issue_reports_user_updated" ON "issue_reports" ("user_id", "updated_at" DESC)`);
		await queryRunner.query(`CREATE INDEX "idx_issue_reports_status_updated" ON "issue_reports" ("status", "updated_at" DESC)`);
		await queryRunner.query(`
			CREATE TABLE "issue_report_updates" (
				"id" uuid NOT NULL,
				"report_id" uuid NOT NULL,
				"actor_id" uuid,
				"body" varchar(2000) NOT NULL,
				"is_internal" boolean NOT NULL DEFAULT false,
				"created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
				CONSTRAINT "pk_issue_report_updates" PRIMARY KEY ("id"),
				CONSTRAINT "fk_issue_report_updates_report" FOREIGN KEY ("report_id") REFERENCES "issue_reports"("id") ON DELETE CASCADE,
				CONSTRAINT "fk_issue_report_updates_actor" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL
			)
		`);
		await queryRunner.query(`CREATE INDEX "idx_issue_report_updates_report_created" ON "issue_report_updates" ("report_id", "created_at")`);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`DROP TABLE "issue_report_updates"`);
		await queryRunner.query(`DROP TABLE "issue_reports"`);
	}
}
