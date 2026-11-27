import type { MigrationInterface, QueryRunner } from "typeorm";

export class AddMultiServiceInvitesAndLinkedAccounts1798300000047 implements MigrationInterface {

	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`ALTER TABLE "invitations" ADD COLUMN IF NOT EXISTS "include_flixer" boolean NOT NULL DEFAULT true`);

		await queryRunner.query(`CREATE TABLE "invitation_servers" (
			"id" uuid NOT NULL,
			"invitation_id" uuid NOT NULL,
			"server_id" uuid NOT NULL,
			"created_at" timestamptz NOT NULL DEFAULT now(),
			CONSTRAINT "PK_invitation_servers" PRIMARY KEY ("id"),
			CONSTRAINT "FK_invitation_servers_invitation" FOREIGN KEY ("invitation_id") REFERENCES "invitations"("id") ON DELETE CASCADE,
			CONSTRAINT "FK_invitation_servers_server" FOREIGN KEY ("server_id") REFERENCES "invite_servers"("id") ON DELETE CASCADE
		)`);
		await queryRunner.query('CREATE UNIQUE INDEX "UQ_invitation_servers_pair" ON "invitation_servers" ("invitation_id", "server_id")');
		await queryRunner.query('CREATE INDEX "IDX_invitation_servers_invitation" ON "invitation_servers" ("invitation_id")');

		// Backfill single-server invitations into invitation_servers.
		await queryRunner.query(`
			INSERT INTO "invitation_servers" ("id", "invitation_id", "server_id", "created_at")
			SELECT gen_random_uuid(), "id", "server_id", "created_at"
			FROM "invitations"
			WHERE "server_id" IS NOT NULL
			ON CONFLICT ("invitation_id", "server_id") DO NOTHING
		`);

		await queryRunner.query(`CREATE TABLE "user_linked_accounts" (
			"id" uuid NOT NULL,
			"user_id" uuid NOT NULL,
			"server_id" uuid NOT NULL,
			"external_user_id" varchar(128),
			"external_username" varchar(128),
			"external_email" varchar(254),
			"status" varchar(32) NOT NULL DEFAULT 'completed',
			"error" text,
			"pending_credentials" text,
			"last_synced_at" timestamptz,
			"created_at" timestamptz NOT NULL DEFAULT now(),
			"updated_at" timestamptz NOT NULL DEFAULT now(),
			CONSTRAINT "PK_user_linked_accounts" PRIMARY KEY ("id"),
			CONSTRAINT "FK_user_linked_accounts_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,
			CONSTRAINT "FK_user_linked_accounts_server" FOREIGN KEY ("server_id") REFERENCES "invite_servers"("id") ON DELETE CASCADE
		)`);
		await queryRunner.query('CREATE UNIQUE INDEX "UQ_user_linked_accounts_pair" ON "user_linked_accounts" ("user_id", "server_id")');
		await queryRunner.query('CREATE INDEX "IDX_user_linked_accounts_user" ON "user_linked_accounts" ("user_id")');
		await queryRunner.query('CREATE INDEX "IDX_user_linked_accounts_server" ON "user_linked_accounts" ("server_id")');

		// Backfill existing invitation usages into user_linked_accounts.
		await queryRunner.query(`
			INSERT INTO "user_linked_accounts" ("id", "user_id", "server_id", "external_user_id", "external_username", "external_email", "status", "error", "pending_credentials", "created_at", "updated_at")
			SELECT DISTINCT ON (u."user_id", i."server_id")
				gen_random_uuid(), u."user_id", i."server_id", u."external_user_id", u."username", u."external_email", u."status", u."error", u."pending_credentials", u."created_at", u."created_at"
			FROM "invitation_usages" u
			INNER JOIN "invitations" i ON i."id" = u."invitation_id"
			WHERE u."user_id" IS NOT NULL AND i."server_id" IS NOT NULL
			ORDER BY u."user_id", i."server_id", u."created_at" DESC
			ON CONFLICT ("user_id", "server_id") DO NOTHING
		`);

		// RLS policies matching flixer_app conventions.
		await queryRunner.query(`ALTER TABLE "invitation_servers" ENABLE ROW LEVEL SECURITY`);
		await queryRunner.query(`DROP POLICY IF EXISTS "rls_admin_only" ON "invitation_servers"`);
		await queryRunner.query(`
			CREATE POLICY "rls_admin_only" ON "invitation_servers"
			AS PERMISSIVE FOR ALL TO "flixer_app"
			USING (app_current_user_role() = 'admin')
			WITH CHECK (app_current_user_role() = 'admin')
		`);

		await queryRunner.query(`ALTER TABLE "user_linked_accounts" ENABLE ROW LEVEL SECURITY`);
		await queryRunner.query(`DROP POLICY IF EXISTS "rls_user_linked_accounts" ON "user_linked_accounts"`);
		await queryRunner.query(`
			CREATE POLICY "rls_user_linked_accounts" ON "user_linked_accounts"
			AS PERMISSIVE FOR ALL TO "flixer_app"
			USING ("user_id" = app_current_user_id() OR app_current_user_role() = 'admin')
			WITH CHECK ("user_id" = app_current_user_id() OR app_current_user_role() = 'admin')
		`);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`DROP POLICY IF EXISTS "rls_user_linked_accounts" ON "user_linked_accounts"`);
		await queryRunner.query(`ALTER TABLE "user_linked_accounts" DISABLE ROW LEVEL SECURITY`);
		await queryRunner.query(`DROP TABLE IF EXISTS "user_linked_accounts"`);

		await queryRunner.query(`DROP POLICY IF EXISTS "rls_admin_only" ON "invitation_servers"`);
		await queryRunner.query(`ALTER TABLE "invitation_servers" DISABLE ROW LEVEL SECURITY`);
		await queryRunner.query(`DROP TABLE IF EXISTS "invitation_servers"`);

		await queryRunner.query(`ALTER TABLE "invitations" DROP COLUMN IF EXISTS "include_flixer"`);
	}
}
