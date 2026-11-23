import { Inject, Injectable } from "@tsed/di";
import { DataSource } from "typeorm";
import { DefaultDataSource } from "../../datasources/defaultDataSource.datasource.js";
import { OidcArtifact, OidcConsent } from "../../entities/oidc.entity.js";

/** Manages an account's approved third-party applications. */
@Injectable()
export class OidcConsentService {

	constructor(@Inject(DefaultDataSource) private readonly dataSource: DataSource) {}

	async list(accountId: string): Promise<Array<{ id: string; name: string; scopes: string[] }>> {
		return this.dataSource.getRepository(OidcConsent).createQueryBuilder("consent").innerJoin("consent.client", "c").select("c.id", "id").addSelect("c.name", "name").addSelect("consent.scopes", "scopes").where("consent.accountId = :accountId", { accountId }).orderBy("c.name").addOrderBy("c.id").getRawMany<{ id: string; name: string; scopes: string[] }>();
	}

	async revoke(accountId: string, clientId: string): Promise<void> {
		await this.dataSource.transaction(async (manager) => {
			await manager.delete(OidcConsent, { accountId, clientId });
			// RAW SQL: PostgreSQL JSONB ->> payload predicates and Grant subquery.
			await manager.createQueryBuilder().delete().from(OidcArtifact).where("(\"payload\"->>'accountId' = :accountId AND \"payload\"->>'clientId' = :clientId) OR \"payload\"->>'grantId' IN (SELECT id FROM \"oidc_artifacts\" WHERE kind = 'Grant' AND \"payload\"->>'accountId' = :accountId AND \"payload\"->>'clientId' = :clientId)", { accountId, clientId }).execute();
		});
	}
}
