import type { MigrationInterface, QueryRunner } from "typeorm";

/** Keeps account approvals separate from short-lived provider grants and browser sessions. */
export class CreateOidcConsents1798300000017 implements MigrationInterface {

	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			CREATE TABLE "oidc_consents" (
				"account_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
				"client_id" varchar(64) NOT NULL REFERENCES "oidc_clients"("id") ON DELETE CASCADE,
				"scopes" text[] NOT NULL,
				"claims" text[] NOT NULL,
				PRIMARY KEY ("account_id", "client_id")
			)
		`);
		await queryRunner.query(`
			WITH grants AS (
				SELECT u.id AS account_id, c.id AS client_id, a.payload
				FROM "oidc_artifacts" a
				JOIN "users" u ON u.id::text = a.payload->>'accountId'
				JOIN "oidc_clients" c ON c.id = a.payload->>'clientId'
				WHERE a.kind = 'Grant' AND (a.expires_at IS NULL OR a.expires_at > now())
					AND jsonb_typeof(a.payload->'openid'->'scope') = 'string'
					AND a.payload->'openid'->>'scope' <> ''
			)
			INSERT INTO "oidc_consents" ("account_id", "client_id", "scopes", "claims")
			SELECT g.account_id, g.client_id,
				ARRAY(SELECT DISTINCT scope FROM grants s
					CROSS JOIN LATERAL unnest(string_to_array(s.payload->'openid'->>'scope', ' ')) AS scope
					WHERE s.account_id = g.account_id AND s.client_id = g.client_id AND scope <> ''
						AND (scope = 'openid' OR NOT scope = ANY(string_to_array(COALESCE(s.payload->'rejected'->'openid'->>'scope', ''), ' ')))),
				ARRAY(SELECT DISTINCT claim FROM grants s
					CROSS JOIN LATERAL jsonb_array_elements_text(
						CASE WHEN jsonb_typeof(s.payload->'openid'->'claims') = 'array'
						THEN s.payload->'openid'->'claims' ELSE '[]'::jsonb END) AS claim
					WHERE s.account_id = g.account_id AND s.client_id = g.client_id
						AND NOT (CASE WHEN jsonb_typeof(s.payload->'rejected'->'openid'->'claims') = 'array'
							THEN s.payload->'rejected'->'openid'->'claims' ELSE '[]'::jsonb END) ? claim)
			FROM grants g GROUP BY g.account_id, g.client_id
		`);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`DROP TABLE "oidc_consents"`);
	}
}
