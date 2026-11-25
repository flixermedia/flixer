import type { MigrationInterface, QueryRunner } from "typeorm";

const DIRECT_USER_TABLES = [
	"favorites",
	"watch_progress",
	"watch_later_items",
	"up_next_queue_items",
	"recommendation_feedback",
	"playback_history",
	"listening_history",
	"playback_history_hidden_sessions",
	"push_subscriptions",
	"user_webhooks",
] as const;

export class EnableUserOwnedRls1798300000043 implements MigrationInterface {

	async up(queryRunner: QueryRunner): Promise<void> {
		for (const table of DIRECT_USER_TABLES) {
			await queryRunner.query(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`);
			await queryRunner.query(`DROP POLICY IF EXISTS "rls_user_isolation" ON "${table}"`);
			await queryRunner.query(`
				CREATE POLICY "rls_user_isolation" ON "${table}"
				FOR ALL TO flixer_app
				USING ("user_id" = app_current_user_id())
				WITH CHECK ("user_id" = app_current_user_id())
			`);
		}
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		for (const table of DIRECT_USER_TABLES) {
			await queryRunner.query(`DROP POLICY IF EXISTS "rls_user_isolation" ON "${table}"`);
			await queryRunner.query(`ALTER TABLE "${table}" DISABLE ROW LEVEL SECURITY`);
		}
	}
}
