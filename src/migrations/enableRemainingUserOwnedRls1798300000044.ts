import type { MigrationInterface, QueryRunner } from "typeorm";

const STRICT_USER_TABLES = [
	"ai_recommendation_caches",
	"passkey_credentials",
	"external_identities",
	"viewing_sessions",
	"listening_events",
	"advertisement_views",
	"chat_mls_devices",
	"chat_mls_history_backups",
] as const;

const USER_OR_ADMIN_TABLES = [
	"api_keys",
	"notifications",
	"user_sessions",
	"user_access_policies",
	"request_user_limits",
	"media_requests",
	"issue_reports",
	"payment_customers",
	"payment_methods",
	"payment_signups",
	"payment_subscriptions",
	"payment_orders",
	"payment_entitlements",
] as const;

/** Enables RLS on all remaining strictly user-owned and user-or-admin tables. */
export class EnableRemainingUserOwnedRls1798300000044 implements MigrationInterface {
	name = "EnableRemainingUserOwnedRls1798300000044";

	async up(queryRunner: QueryRunner): Promise<void> {
		for (const table of STRICT_USER_TABLES) {
			await queryRunner.query(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`);
			await queryRunner.query(`DROP POLICY IF EXISTS "rls_user_isolation" ON "${table}"`);
			await queryRunner.query(`
				CREATE POLICY "rls_user_isolation" ON "${table}"
				AS PERMISSIVE FOR ALL TO "flixer_app"
				USING ("user_id" = app_current_user_id())
				WITH CHECK ("user_id" = app_current_user_id())
			`);
		}

		await queryRunner.query(`ALTER TABLE "oidc_consents" ENABLE ROW LEVEL SECURITY`);
		await queryRunner.query(`DROP POLICY IF EXISTS "rls_user_isolation" ON "oidc_consents"`);
		await queryRunner.query(`
			CREATE POLICY "rls_user_isolation" ON "oidc_consents"
			AS PERMISSIVE FOR ALL TO "flixer_app"
			USING ("account_id" = app_current_user_id())
			WITH CHECK ("account_id" = app_current_user_id())
		`);

		for (const table of USER_OR_ADMIN_TABLES) {
			await queryRunner.query(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`);
			await queryRunner.query(`DROP POLICY IF EXISTS "rls_user_or_admin" ON "${table}"`);
			await queryRunner.query(`
				CREATE POLICY "rls_user_or_admin" ON "${table}"
				AS PERMISSIVE FOR ALL TO "flixer_app"
				USING ("user_id" = app_current_user_id() OR app_current_user_role() = 'admin')
				WITH CHECK ("user_id" = app_current_user_id() OR app_current_user_role() = 'admin')
			`);
		}

		await queryRunner.query(`ALTER TABLE "issue_report_updates" ENABLE ROW LEVEL SECURITY`);
		await queryRunner.query(`DROP POLICY IF EXISTS "rls_user_or_admin" ON "issue_report_updates"`);
		await queryRunner.query(`
			CREATE POLICY "rls_user_or_admin" ON "issue_report_updates"
			AS PERMISSIVE FOR ALL TO "flixer_app"
			USING (
				app_current_user_role() = 'admin'
				OR EXISTS (
					SELECT 1 FROM "issue_reports" r
					WHERE r."id" = "issue_report_updates"."report_id"
					AND r."user_id" = app_current_user_id()
				)
			)
			WITH CHECK (
				app_current_user_role() = 'admin'
				OR EXISTS (
					SELECT 1 FROM "issue_reports" r
					WHERE r."id" = "issue_report_updates"."report_id"
					AND r."user_id" = app_current_user_id()
				)
			)
		`);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`DROP POLICY IF EXISTS "rls_user_or_admin" ON "issue_report_updates"`);
		await queryRunner.query(`ALTER TABLE "issue_report_updates" DISABLE ROW LEVEL SECURITY`);
		for (const table of [...USER_OR_ADMIN_TABLES].reverse()) {
			await queryRunner.query(`DROP POLICY IF EXISTS "rls_user_or_admin" ON "${table}"`);
			await queryRunner.query(`ALTER TABLE "${table}" DISABLE ROW LEVEL SECURITY`);
		}
		await queryRunner.query(`DROP POLICY IF EXISTS "rls_user_isolation" ON "oidc_consents"`);
		await queryRunner.query(`ALTER TABLE "oidc_consents" DISABLE ROW LEVEL SECURITY`);
		for (const table of [...STRICT_USER_TABLES].reverse()) {
			await queryRunner.query(`DROP POLICY IF EXISTS "rls_user_isolation" ON "${table}"`);
			await queryRunner.query(`ALTER TABLE "${table}" DISABLE ROW LEVEL SECURITY`);
		}
	}
}
