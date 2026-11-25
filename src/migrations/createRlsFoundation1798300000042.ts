import type { MigrationInterface, QueryRunner } from "typeorm";

export class CreateRlsFoundation1798300000042 implements MigrationInterface {

	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			DO $$
			BEGIN
				IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'flixer_app') THEN
					CREATE ROLE flixer_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
				END IF;
			END
			$$;
		`);
		await queryRunner.query(`GRANT USAGE ON SCHEMA public TO flixer_app`);
		await queryRunner.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO flixer_app`);
		await queryRunner.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO flixer_app`);
		await queryRunner.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO flixer_app`);
		await queryRunner.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO flixer_app`);

		await queryRunner.query(`
			CREATE OR REPLACE FUNCTION app_current_user_id() RETURNS uuid
			LANGUAGE sql STABLE AS $$
				SELECT NULLIF(current_setting('app.user_id', true), '')::uuid;
			$$;
		`);
		await queryRunner.query(`
			CREATE OR REPLACE FUNCTION app_current_user_role() RETURNS text
			LANGUAGE sql STABLE AS $$
				SELECT COALESCE(NULLIF(current_setting('app.user_role', true), ''), 'anonymous');
			$$;
		`);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`DROP FUNCTION IF EXISTS app_current_user_role()`);
		await queryRunner.query(`DROP FUNCTION IF EXISTS app_current_user_id()`);
	}
}
