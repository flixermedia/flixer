import { Inject, Injectable } from "@tsed/di";
import { BadRequest, NotFound } from "@tsed/exceptions";
import { randomBytes } from "node:crypto";
import { DataSource } from "typeorm";
import { DefaultDataSource } from "../../datasources/defaultDataSource.datasource.js";
import { OidcArtifact, OidcClient, OidcConsent } from "../../entities/oidc.entity.js";
import type { CreateOidcClientRequest } from "./oidcClientRequests.js";
import { encryptOidcSecret } from "./oidcSecrets.js";
import { isOidcResourceScope } from "./oidcResourceScopes.js";

interface ClientRow {
	id: string;
	name: string;
	redirectUris: string[];
	confidential: boolean;
	resourceScopes: string[];
	createdAt: Date;
}

function publicClient(row: ClientRow) {
	return { id: row.id, name: row.name, redirectUris: row.redirectUris, type: row.confidential ? "confidential" : "public", resourceScopes: row.resourceScopes, createdAt: row.createdAt };
}

/** Exact redirect URI matching is required by the provider; never normalize registered values. */
export function validateOidcRedirectUris(uris: string[]): void {

	if (!Array.isArray(uris) || uris.length < 1 || uris.length > 10 || new Set(uris).size !== uris.length) {
		throw new BadRequest("Provide between one and ten unique redirect URIs.");
	}
	for (const uri of uris) {
		if (typeof uri !== "string" || uri.length > 2048 || uri !== uri.trim() || uri.includes("#")) throw new BadRequest("Invalid redirect URI.");
		let parsed: URL;
		try {
			parsed = new URL(uri);
		} catch {
			throw new BadRequest("Invalid redirect URI.");
		}
		const loopback = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "[::1]";
		if ((parsed.protocol !== "https:" && !(parsed.protocol === "http:" && loopback)) || parsed.username || parsed.password) {
			throw new BadRequest("Redirect URIs must use HTTPS, except for HTTP loopback addresses.");
		}
	}

}

@Injectable()
export class OidcClientService {

	constructor(@Inject(DefaultDataSource) private readonly dataSource: DataSource) {}

	async list() {
		const rows = await this.dataSource.getRepository(OidcClient).find({
			select: { id: true, name: true, redirectUris: true, secretEncrypted: true, resourceScopes: true, createdAt: true },
			order: { createdAt: "DESC" },
		});
		return rows.map((row) => publicClient({ ...row, confidential: row.secretEncrypted !== null }));
	}

	async create(request: CreateOidcClientRequest) {
		const name = request.name?.trim();
		if (!name || name.length > 100) throw new BadRequest("A client name is required.");
		if (request.type !== "public" && request.type !== "confidential") throw new BadRequest("Invalid client type.");
		validateOidcRedirectUris(request.redirectUris);
		const id = randomBytes(24).toString("base64url");
		const secret = request.type === "confidential" ? randomBytes(48).toString("base64url") : undefined;
		// Database defaults (created_at, resource_scopes) come back through the insert's RETURNING.
		const { generatedMaps } = await this.dataSource.getRepository(OidcClient).insert({ id, name, redirectUris: request.redirectUris, secretEncrypted: secret ? encryptOidcSecret(secret) : null });
		const { createdAt, resourceScopes } = generatedMaps[0] as Pick<OidcClient, "createdAt" | "resourceScopes">;
		return { ...publicClient({ id, name, redirectUris: request.redirectUris, confidential: !!secret, resourceScopes, createdAt }), ...(secret ? { secret } : {}) };
	}

	async setResourceScopes(id: string, scopes: string[]): Promise<void> {
		if (!Array.isArray(scopes) || scopes.some((scope) => typeof scope !== "string" || !isOidcResourceScope(scope)) || new Set(scopes).size !== scopes.length) throw new BadRequest("Invalid resource permissions.");
		await this.dataSource.transaction(async (manager) => {
			const client = await manager.getRepository(OidcClient).createQueryBuilder("client").select("client.resourceScopes", "resource_scopes").where("client.id = :id", { id }).setLock("pessimistic_write").getRawOne<{ resource_scopes: string[] }>();
			if (!client) throw new NotFound("OAuth client not found.");
			const removed = client.resource_scopes.filter((scope) => !scopes.includes(scope));
			await manager.update(OidcClient, { id }, { resourceScopes: scopes });
			if (removed.length) {
				// RAW SQL: PostgreSQL text[] EXCEPT/unnest set difference.
				await manager
					.createQueryBuilder()
					.update(OidcConsent)
					.set({ scopes: () => 'ARRAY(SELECT unnest("scopes") EXCEPT SELECT unnest(:removed::text[]))' })
					.where('"client_id" = :id', { id })
					.setParameter("removed", removed)
					.execute();
				// RAW SQL: PostgreSQL JSONB ->> payload predicates and Grant subquery.
				await manager.createQueryBuilder().delete().from(OidcArtifact).where("\"payload\"->>'clientId' = :id OR \"payload\"->>'grantId' IN (SELECT id FROM \"oidc_artifacts\" WHERE kind = 'Grant' AND \"payload\"->>'clientId' = :id)", { id }).execute();
			}
		});
	}

	async remove(id: string): Promise<void> {
		await this.dataSource.transaction(async (manager) => {
			const { affected } = await manager.delete(OidcClient, { id });
			if (!affected) throw new NotFound("OAuth client not found.");
			// RAW SQL: PostgreSQL JSONB ->> payload predicate.
			await manager.createQueryBuilder().delete().from(OidcArtifact).where("\"payload\"->>'clientId' = :id", { id }).execute();
		});
	}
}
