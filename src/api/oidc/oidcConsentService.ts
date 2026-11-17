import { Inject, Injectable } from "@tsed/di";
import { DataSource } from "typeorm";
import { DefaultDataSource } from "../../datasources/defaultDataSource.datasource.js";

/** Manages an account's approved third-party applications. */
@Injectable()
export class OidcConsentService {
	constructor(@Inject(DefaultDataSource) private readonly dataSource: DataSource) {}

	async list(accountId: string): Promise<Array<{ id: string; name: string; scopes: string[] }>> {
		return this.dataSource.query(
			`SELECT c.id, c.name, consent.scopes FROM "oidc_consents" consent
			 JOIN "oidc_clients" c ON c.id = consent.client_id
			 WHERE consent.account_id = $1 ORDER BY c.name, c.id`,
			[accountId],
		);
	}

	async revoke(accountId: string, clientId: string): Promise<void> {
		await this.dataSource.transaction(async (manager) => {
			await manager.query(`DELETE FROM "oidc_consents" WHERE account_id = $1 AND client_id = $2`, [accountId, clientId]);
			await manager.query(
				`DELETE FROM "oidc_artifacts" WHERE
					("payload"->>'accountId' = $1 AND "payload"->>'clientId' = $2)
					OR "payload"->>'grantId' IN (
						SELECT id FROM "oidc_artifacts" WHERE kind = 'Grant'
						AND "payload"->>'accountId' = $1 AND "payload"->>'clientId' = $2
					)`,
				[accountId, clientId],
			);
		});
	}
}
