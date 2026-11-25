import type { MigrationInterface, QueryRunner } from "typeorm";

const PUBLIC_READ_ADMIN_WRITE_TABLES = [
	"media_libraries",
	"media_items",
	"media_credits",
	"media_segments",
	"media_source_groups",
	"person_profiles",
	"guide_sources",
	"guide_programmes",
	"themes",
	"theme_versions",
	"advertisements",
	"advertisement_settings",
	"payment_products",
	"payment_plans",
	"payment_coupons",
	"external_oauth_providers",
	"push_keys",
] as const;

const ADMIN_ONLY_TABLES = [
	"settings",
	"user_webhook_config",
	"guide_settings",
	"mail_domains",
	"mail_server_settings",
	"network_shares",
	"request_services",
	"invitations",
	"invitation_usages",
	"invite_servers",
	"payment_config",
	"payment_events",
	"plugin_repositories",
	"plugin_installations",
	"plugin_secrets",
	"plugin_storage",
	"plugin_update_history",
	"media_organization_settings",
	"media_organization_plans",
	"media_organization_plan_audit",
	"media_search_outbox",
	"media_search_lyrics",
	"oidc_clients",
	"oidc_artifacts",
	"oidc_config",
	"passkey_challenges",
	"native_passkey_handoffs",
	"external_auth_flows",
	"quick_connect_requests",
] as const;

/** Enables RLS on catalog/reference, users, and admin/system tables. */
export class EnableCatalogAndAdminRls1798300000046 implements MigrationInterface {
	name = "EnableCatalogAndAdminRls1798300000046";

	async up(queryRunner: QueryRunner): Promise<void> {
		for (const table of PUBLIC_READ_ADMIN_WRITE_TABLES) {
			await queryRunner.query(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`);
			await queryRunner.query(`DROP POLICY IF EXISTS "rls_public_read" ON "${table}"`);
			await queryRunner.query(`
				CREATE POLICY "rls_public_read" ON "${table}"
				AS PERMISSIVE FOR SELECT TO "flixer_app"
				USING (true)
			`);
			await queryRunner.query(`DROP POLICY IF EXISTS "rls_admin_write" ON "${table}"`);
			await queryRunner.query(`
				CREATE POLICY "rls_admin_write" ON "${table}"
				AS PERMISSIVE FOR ALL TO "flixer_app"
				USING (app_current_user_role() = 'admin')
				WITH CHECK (app_current_user_role() = 'admin')
			`);
		}

		// Users: authenticated users can read basic user rows (for social/chat/profiles), self or admin can update, admin can insert/delete
		await queryRunner.query(`ALTER TABLE "users" ENABLE ROW LEVEL SECURITY`);
		await queryRunner.query(`DROP POLICY IF EXISTS "rls_users_select" ON "users"`);
		await queryRunner.query(`
			CREATE POLICY "rls_users_select" ON "users"
			AS PERMISSIVE FOR SELECT TO "flixer_app"
			USING (app_current_user_id() IS NOT NULL OR app_current_user_role() = 'admin')
		`);
		await queryRunner.query(`DROP POLICY IF EXISTS "rls_users_update" ON "users"`);
		await queryRunner.query(`
			CREATE POLICY "rls_users_update" ON "users"
			AS PERMISSIVE FOR UPDATE TO "flixer_app"
			USING ("id" = app_current_user_id() OR app_current_user_role() = 'admin')
			WITH CHECK ("id" = app_current_user_id() OR app_current_user_role() = 'admin')
		`);
		await queryRunner.query(`DROP POLICY IF EXISTS "rls_users_admin" ON "users"`);
		await queryRunner.query(`
			CREATE POLICY "rls_users_admin" ON "users"
			AS PERMISSIVE FOR ALL TO "flixer_app"
			USING (app_current_user_role() = 'admin')
			WITH CHECK (app_current_user_role() = 'admin')
		`);

		for (const table of ADMIN_ONLY_TABLES) {
			await queryRunner.query(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`);
			await queryRunner.query(`DROP POLICY IF EXISTS "rls_admin_only" ON "${table}"`);
			await queryRunner.query(`
				CREATE POLICY "rls_admin_only" ON "${table}"
				AS PERMISSIVE FOR ALL TO "flixer_app"
				USING (app_current_user_role() = 'admin')
				WITH CHECK (app_current_user_role() = 'admin')
			`);
		}
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		for (const table of [...ADMIN_ONLY_TABLES].reverse()) {
			await queryRunner.query(`DROP POLICY IF EXISTS "rls_admin_only" ON "${table}"`);
			await queryRunner.query(`ALTER TABLE "${table}" DISABLE ROW LEVEL SECURITY`);
		}

		await queryRunner.query(`DROP POLICY IF EXISTS "rls_users_admin" ON "users"`);
		await queryRunner.query(`DROP POLICY IF EXISTS "rls_users_update" ON "users"`);
		await queryRunner.query(`DROP POLICY IF EXISTS "rls_users_select" ON "users"`);
		await queryRunner.query(`ALTER TABLE "users" DISABLE ROW LEVEL SECURITY`);

		for (const table of [...PUBLIC_READ_ADMIN_WRITE_TABLES].reverse()) {
			await queryRunner.query(`DROP POLICY IF EXISTS "rls_admin_write" ON "${table}"`);
			await queryRunner.query(`DROP POLICY IF EXISTS "rls_public_read" ON "${table}"`);
			await queryRunner.query(`ALTER TABLE "${table}" DISABLE ROW LEVEL SECURITY`);
		}
	}
}
