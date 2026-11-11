import type { MigrationInterface, QueryRunner } from "typeorm";

/** Remove the legacy subscription claim and its stored authorizations. */
export class RemoveOidcSubscriptionClaim1798300000020 implements MigrationInterface {
	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			DELETE FROM "oidc_artifacts"
			WHERE "payload"->>'clientId' IN (
				SELECT "id" FROM "oidc_clients" WHERE "share_subscription"
				UNION SELECT "client_id" FROM "oidc_consents"
				WHERE 'subscription' = ANY("scopes") OR 'flixer_subscription_active' = ANY("claims")
			)
			OR "payload"->>'grantId' IN (
				SELECT "id" FROM "oidc_artifacts" WHERE "kind" = 'Grant' AND "payload"->>'clientId' IN (
					SELECT "id" FROM "oidc_clients" WHERE "share_subscription"
					UNION SELECT "client_id" FROM "oidc_consents"
					WHERE 'subscription' = ANY("scopes") OR 'flixer_subscription_active' = ANY("claims")
				)
			)
		`);
		await queryRunner.query(`UPDATE "oidc_consents" SET "scopes" = array_remove("scopes", 'subscription'), "claims" = array_remove("claims", 'flixer_subscription_active') WHERE 'subscription' = ANY("scopes") OR 'flixer_subscription_active' = ANY("claims")`);
		await queryRunner.query(`ALTER TABLE "oidc_clients" DROP COLUMN "share_subscription"`);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`ALTER TABLE "oidc_clients" ADD COLUMN "share_subscription" boolean NOT NULL DEFAULT false`);
	}
}
