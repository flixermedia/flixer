import type { DataSource } from "typeorm";

/** Removes expired provider artifacts without touching active grants or sessions. */
export async function cleanupExpiredOidcArtifacts(dataSource: DataSource): Promise<void> {

	// RAW SQL: no entity for oidc_artifacts
	await dataSource.query(`DELETE FROM "oidc_artifacts" WHERE "expires_at" <= now()`);

}
