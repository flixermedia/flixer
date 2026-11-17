import type { DataSource } from "typeorm";
import { OidcArtifact } from "../../entities/oidc.entity.js";

/** Removes expired provider artifacts without touching active grants or sessions. */
export async function cleanupExpiredOidcArtifacts(dataSource: DataSource): Promise<void> {

	// Compares against the database clock, as the previous raw delete did.
	await dataSource.createQueryBuilder().delete().from(OidcArtifact).where(`"expires_at" <= now()`).execute();

}
