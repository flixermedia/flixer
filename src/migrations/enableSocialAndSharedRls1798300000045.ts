import type { MigrationInterface, QueryRunner } from "typeorm";

const TABLES = [
	"playlists",
	"playlist_items",
	"video_collections",
	"video_collection_items",
	"user_preferences",
	"social_friendships",
	"social_friend_invites",
	"chat_conversations",
	"chat_members",
	"chat_messages",
	"chat_mls_key_packages",
	"chat_mls_welcomes",
	"mailboxes",
	"mail_messages",
] as const;

/** Enables RLS on visibility-shared, social, chat/MLS, and mail tables. */
export class EnableSocialAndSharedRls1798300000045 implements MigrationInterface {
	name = "EnableSocialAndSharedRls1798300000045";

	async up(queryRunner: QueryRunner): Promise<void> {
		for (const table of TABLES) {
			await queryRunner.query(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`);
		}

		// Playlists & playlist_items
		await queryRunner.query(`DROP POLICY IF EXISTS "rls_playlists_select" ON "playlists"`);
		await queryRunner.query(`
			CREATE POLICY "rls_playlists_select" ON "playlists"
			AS PERMISSIVE FOR SELECT TO "flixer_app"
			USING ("user_id" = app_current_user_id() OR "is_public" = true)
		`);
		await queryRunner.query(`DROP POLICY IF EXISTS "rls_playlists_write" ON "playlists"`);
		await queryRunner.query(`
			CREATE POLICY "rls_playlists_write" ON "playlists"
			AS PERMISSIVE FOR ALL TO "flixer_app"
			USING ("user_id" = app_current_user_id())
			WITH CHECK ("user_id" = app_current_user_id())
		`);

		await queryRunner.query(`DROP POLICY IF EXISTS "rls_playlist_items_select" ON "playlist_items"`);
		await queryRunner.query(`
			CREATE POLICY "rls_playlist_items_select" ON "playlist_items"
			AS PERMISSIVE FOR SELECT TO "flixer_app"
			USING (EXISTS (SELECT 1 FROM "playlists" p WHERE p."id" = "playlist_items"."playlist_id" AND (p."user_id" = app_current_user_id() OR p."is_public" = true)))
		`);
		await queryRunner.query(`DROP POLICY IF EXISTS "rls_playlist_items_write" ON "playlist_items"`);
		await queryRunner.query(`
			CREATE POLICY "rls_playlist_items_write" ON "playlist_items"
			AS PERMISSIVE FOR ALL TO "flixer_app"
			USING (EXISTS (SELECT 1 FROM "playlists" p WHERE p."id" = "playlist_items"."playlist_id" AND p."user_id" = app_current_user_id()))
			WITH CHECK (EXISTS (SELECT 1 FROM "playlists" p WHERE p."id" = "playlist_items"."playlist_id" AND p."user_id" = app_current_user_id()))
		`);

		// Video collections & video_collection_items
		await queryRunner.query(`DROP POLICY IF EXISTS "rls_video_collections_select" ON "video_collections"`);
		await queryRunner.query(`
			CREATE POLICY "rls_video_collections_select" ON "video_collections"
			AS PERMISSIVE FOR SELECT TO "flixer_app"
			USING ("user_id" = app_current_user_id() OR "is_public" = true)
		`);
		await queryRunner.query(`DROP POLICY IF EXISTS "rls_video_collections_write" ON "video_collections"`);
		await queryRunner.query(`
			CREATE POLICY "rls_video_collections_write" ON "video_collections"
			AS PERMISSIVE FOR ALL TO "flixer_app"
			USING ("user_id" = app_current_user_id())
			WITH CHECK ("user_id" = app_current_user_id())
		`);

		await queryRunner.query(`DROP POLICY IF EXISTS "rls_video_collection_items_select" ON "video_collection_items"`);
		await queryRunner.query(`
			CREATE POLICY "rls_video_collection_items_select" ON "video_collection_items"
			AS PERMISSIVE FOR SELECT TO "flixer_app"
			USING (EXISTS (SELECT 1 FROM "video_collections" c WHERE c."id" = "video_collection_items"."collection_id" AND (c."user_id" = app_current_user_id() OR c."is_public" = true)))
		`);
		await queryRunner.query(`DROP POLICY IF EXISTS "rls_video_collection_items_write" ON "video_collection_items"`);
		await queryRunner.query(`
			CREATE POLICY "rls_video_collection_items_write" ON "video_collection_items"
			AS PERMISSIVE FOR ALL TO "flixer_app"
			USING (EXISTS (SELECT 1 FROM "video_collections" c WHERE c."id" = "video_collection_items"."collection_id" AND c."user_id" = app_current_user_id()))
			WITH CHECK (EXISTS (SELECT 1 FROM "video_collections" c WHERE c."id" = "video_collection_items"."collection_id" AND c."user_id" = app_current_user_id()))
		`);

		// User preferences (owner + visibility-based profile reads)
		await queryRunner.query(`DROP POLICY IF EXISTS "rls_user_preferences_select" ON "user_preferences"`);
		await queryRunner.query(`
			CREATE POLICY "rls_user_preferences_select" ON "user_preferences"
			AS PERMISSIVE FOR SELECT TO "flixer_app"
			USING (
				"user_id" = app_current_user_id()
				OR "profile_visibility" = 'public'
				OR (
					"profile_visibility" = 'friends'
					AND EXISTS (
						SELECT 1 FROM "social_friendships" f
						WHERE f."accepted_at" IS NOT NULL
						AND (
							(f."user_low_id" = app_current_user_id() AND f."user_high_id" = "user_preferences"."user_id")
							OR (f."user_high_id" = app_current_user_id() AND f."user_low_id" = "user_preferences"."user_id")
						)
					)
				)
			)
		`);
		await queryRunner.query(`DROP POLICY IF EXISTS "rls_user_preferences_write" ON "user_preferences"`);
		await queryRunner.query(`
			CREATE POLICY "rls_user_preferences_write" ON "user_preferences"
			AS PERMISSIVE FOR ALL TO "flixer_app"
			USING ("user_id" = app_current_user_id())
			WITH CHECK ("user_id" = app_current_user_id())
		`);

		// Social friendships & friend invites
		await queryRunner.query(`DROP POLICY IF EXISTS "rls_social_friendships" ON "social_friendships"`);
		await queryRunner.query(`
			CREATE POLICY "rls_social_friendships" ON "social_friendships"
			AS PERMISSIVE FOR ALL TO "flixer_app"
			USING ("user_low_id" = app_current_user_id() OR "user_high_id" = app_current_user_id())
			WITH CHECK ("user_low_id" = app_current_user_id() OR "user_high_id" = app_current_user_id())
		`);

		await queryRunner.query(`DROP POLICY IF EXISTS "rls_social_friend_invites_select" ON "social_friend_invites"`);
		await queryRunner.query(`
			CREATE POLICY "rls_social_friend_invites_select" ON "social_friend_invites"
			AS PERMISSIVE FOR SELECT TO "flixer_app"
			USING (app_current_user_id() IS NOT NULL)
		`);
		await queryRunner.query(`DROP POLICY IF EXISTS "rls_social_friend_invites_write" ON "social_friend_invites"`);
		await queryRunner.query(`
			CREATE POLICY "rls_social_friend_invites_write" ON "social_friend_invites"
			AS PERMISSIVE FOR ALL TO "flixer_app"
			USING ("owner_id" = app_current_user_id())
			WITH CHECK ("owner_id" = app_current_user_id())
		`);

		// Chat conversations, members, messages, MLS key packages & welcomes
		await queryRunner.query(`DROP POLICY IF EXISTS "rls_chat_conversations" ON "chat_conversations"`);
		await queryRunner.query(`
			CREATE POLICY "rls_chat_conversations" ON "chat_conversations"
			AS PERMISSIVE FOR ALL TO "flixer_app"
			USING (
				"created_by" = app_current_user_id()
				OR EXISTS (SELECT 1 FROM "chat_members" m WHERE m."conversation_id" = "chat_conversations"."id" AND m."user_id" = app_current_user_id())
			)
			WITH CHECK (app_current_user_id() IS NOT NULL)
		`);

		await queryRunner.query(`DROP POLICY IF EXISTS "rls_chat_members" ON "chat_members"`);
		await queryRunner.query(`
			CREATE POLICY "rls_chat_members" ON "chat_members"
			AS PERMISSIVE FOR ALL TO "flixer_app"
			USING (
				"user_id" = app_current_user_id()
				OR EXISTS (SELECT 1 FROM "chat_members" m WHERE m."conversation_id" = "chat_members"."conversation_id" AND m."user_id" = app_current_user_id())
			)
			WITH CHECK (
				"user_id" = app_current_user_id()
				OR EXISTS (SELECT 1 FROM "chat_members" m WHERE m."conversation_id" = "chat_members"."conversation_id" AND m."user_id" = app_current_user_id())
			)
		`);

		await queryRunner.query(`DROP POLICY IF EXISTS "rls_chat_messages_access" ON "chat_messages"`);
		await queryRunner.query(`
			CREATE POLICY "rls_chat_messages_access" ON "chat_messages"
			AS PERMISSIVE FOR SELECT TO "flixer_app"
			USING (EXISTS (SELECT 1 FROM "chat_members" m WHERE m."conversation_id" = "chat_messages"."conversation_id" AND m."user_id" = app_current_user_id()))
		`);
		await queryRunner.query(`DROP POLICY IF EXISTS "rls_chat_messages_insert" ON "chat_messages"`);
		await queryRunner.query(`
			CREATE POLICY "rls_chat_messages_insert" ON "chat_messages"
			AS PERMISSIVE FOR INSERT TO "flixer_app"
			WITH CHECK (EXISTS (SELECT 1 FROM "chat_members" m WHERE m."conversation_id" = "chat_messages"."conversation_id" AND m."user_id" = app_current_user_id()))
		`);
		await queryRunner.query(`DROP POLICY IF EXISTS "rls_chat_messages_modify" ON "chat_messages"`);
		await queryRunner.query(`
			CREATE POLICY "rls_chat_messages_modify" ON "chat_messages"
			AS PERMISSIVE FOR UPDATE TO "flixer_app"
			USING ("user_id" = app_current_user_id())
			WITH CHECK ("user_id" = app_current_user_id())
		`);
		await queryRunner.query(`DROP POLICY IF EXISTS "rls_chat_messages_delete" ON "chat_messages"`);
		await queryRunner.query(`
			CREATE POLICY "rls_chat_messages_delete" ON "chat_messages"
			AS PERMISSIVE FOR DELETE TO "flixer_app"
			USING ("user_id" = app_current_user_id())
		`);

		await queryRunner.query(`DROP POLICY IF EXISTS "rls_chat_mls_key_packages_select" ON "chat_mls_key_packages"`);
		await queryRunner.query(`
			CREATE POLICY "rls_chat_mls_key_packages_select" ON "chat_mls_key_packages"
			AS PERMISSIVE FOR SELECT TO "flixer_app"
			USING (app_current_user_id() IS NOT NULL)
		`);
		await queryRunner.query(`DROP POLICY IF EXISTS "rls_chat_mls_key_packages_write" ON "chat_mls_key_packages"`);
		await queryRunner.query(`
			CREATE POLICY "rls_chat_mls_key_packages_write" ON "chat_mls_key_packages"
			AS PERMISSIVE FOR ALL TO "flixer_app"
			USING (EXISTS (SELECT 1 FROM "chat_mls_devices" d WHERE d."id" = "chat_mls_key_packages"."device_id" AND d."user_id" = app_current_user_id()))
			WITH CHECK (EXISTS (SELECT 1 FROM "chat_mls_devices" d WHERE d."id" = "chat_mls_key_packages"."device_id" AND d."user_id" = app_current_user_id()))
		`);

		await queryRunner.query(`DROP POLICY IF EXISTS "rls_chat_mls_welcomes_access" ON "chat_mls_welcomes"`);
		await queryRunner.query(`
			CREATE POLICY "rls_chat_mls_welcomes_access" ON "chat_mls_welcomes"
			AS PERMISSIVE FOR ALL TO "flixer_app"
			USING (EXISTS (SELECT 1 FROM "chat_mls_devices" d WHERE d."id" = "chat_mls_welcomes"."device_id" AND d."user_id" = app_current_user_id()))
			WITH CHECK (EXISTS (SELECT 1 FROM "chat_members" m WHERE m."conversation_id" = "chat_mls_welcomes"."conversation_id" AND m."user_id" = app_current_user_id()))
		`);

		// Mailboxes & mail_messages
		await queryRunner.query(`DROP POLICY IF EXISTS "rls_mailboxes" ON "mailboxes"`);
		await queryRunner.query(`
			CREATE POLICY "rls_mailboxes" ON "mailboxes"
			AS PERMISSIVE FOR ALL TO "flixer_app"
			USING ("user_id" = app_current_user_id() OR app_current_user_role() = 'admin')
			WITH CHECK ("user_id" = app_current_user_id() OR app_current_user_role() = 'admin')
		`);
		await queryRunner.query(`DROP POLICY IF EXISTS "rls_mail_messages" ON "mail_messages"`);
		await queryRunner.query(`
			CREATE POLICY "rls_mail_messages" ON "mail_messages"
			AS PERMISSIVE FOR ALL TO "flixer_app"
			USING (EXISTS (SELECT 1 FROM "mailboxes" mb WHERE mb."id" = "mail_messages"."mailbox_id" AND (mb."user_id" = app_current_user_id() OR app_current_user_role() = 'admin')))
			WITH CHECK (EXISTS (SELECT 1 FROM "mailboxes" mb WHERE mb."id" = "mail_messages"."mailbox_id" AND (mb."user_id" = app_current_user_id() OR app_current_user_role() = 'admin')))
		`);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		const policyPairs: Array<[string, string]> = [
			["mail_messages", "rls_mail_messages"],
			["mailboxes", "rls_mailboxes"],
			["chat_mls_welcomes", "rls_chat_mls_welcomes_access"],
			["chat_mls_key_packages", "rls_chat_mls_key_packages_write"],
			["chat_mls_key_packages", "rls_chat_mls_key_packages_select"],
			["chat_messages", "rls_chat_messages_delete"],
			["chat_messages", "rls_chat_messages_modify"],
			["chat_messages", "rls_chat_messages_insert"],
			["chat_messages", "rls_chat_messages_access"],
			["chat_members", "rls_chat_members"],
			["chat_conversations", "rls_chat_conversations"],
			["social_friend_invites", "rls_social_friend_invites_write"],
			["social_friend_invites", "rls_social_friend_invites_select"],
			["social_friendships", "rls_social_friendships"],
			["user_preferences", "rls_user_preferences_write"],
			["user_preferences", "rls_user_preferences_select"],
			["video_collection_items", "rls_video_collection_items_write"],
			["video_collection_items", "rls_video_collection_items_select"],
			["video_collections", "rls_video_collections_write"],
			["video_collections", "rls_video_collections_select"],
			["playlist_items", "rls_playlist_items_write"],
			["playlist_items", "rls_playlist_items_select"],
			["playlists", "rls_playlists_write"],
			["playlists", "rls_playlists_select"],
		];
		for (const [table, policy] of policyPairs) {
			await queryRunner.query(`DROP POLICY IF EXISTS "${policy}" ON "${table}"`);
		}
		for (const table of [...TABLES].reverse()) {
			await queryRunner.query(`ALTER TABLE "${table}" DISABLE ROW LEVEL SECURITY`);
		}
	}
}
