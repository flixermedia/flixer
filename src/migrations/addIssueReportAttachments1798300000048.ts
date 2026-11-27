import type { MigrationInterface, QueryRunner } from "typeorm";

export class AddIssueReportAttachments1798300000048 implements MigrationInterface {
	name = "AddIssueReportAttachments1798300000048";

	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`ALTER TABLE "issue_reports" ADD COLUMN IF NOT EXISTS "attachments" jsonb NOT NULL DEFAULT '[]'::jsonb`);
		await queryRunner.query(`ALTER TABLE "issue_report_updates" ADD COLUMN IF NOT EXISTS "attachments" jsonb NOT NULL DEFAULT '[]'::jsonb`);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`ALTER TABLE "issue_report_updates" DROP COLUMN IF EXISTS "attachments"`);
		await queryRunner.query(`ALTER TABLE "issue_reports" DROP COLUMN IF EXISTS "attachments"`);
	}
}
