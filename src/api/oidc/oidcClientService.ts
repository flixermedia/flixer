import { Inject, Injectable } from "@tsed/di";
import { BadRequest, NotFound } from "@tsed/exceptions";
import { randomBytes } from "node:crypto";
import { DataSource } from "typeorm";
import { DefaultDataSource } from "../../datasources/defaultDataSource.datasource.js";
import type { CreateOidcClientRequest } from "./oidcClientRequests.js";
import { encryptOidcSecret } from "./oidcSecrets.js";
import { isOidcResourceScope } from "./oidcResourceScopes.js";

interface ClientRow {
	id: string;
	name: string;
	redirect_uris: string[];
	confidential: boolean;
	resource_scopes: string[];
	created_at: Date;
}

function publicClient(row: ClientRow) {
	return { id: row.id, name: row.name, redirectUris: row.redirect_uris, type: row.confidential ? "confidential" : "public", resourceScopes: row.resource_scopes, createdAt: row.created_at };
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
		const rows: ClientRow[] = await this.dataSource.query(
			`SELECT "id", "name", "redirect_uris", "secret_encrypted" IS NOT NULL AS "confidential", "resource_scopes", "created_at" FROM "oidc_clients" ORDER BY "created_at" DESC`,
		);
		return rows.map(publicClient);
	}

	async create(request: CreateOidcClientRequest) {
		const name = request.name?.trim();
		if (!name || name.length > 100) throw new BadRequest("A client name is required.");
		if (request.type !== "public" && request.type !== "confidential") throw new BadRequest("Invalid client type.");
		validateOidcRedirectUris(request.redirectUris);
		const id = randomBytes(24).toString("base64url");
		const secret = request.type === "confidential" ? randomBytes(48).toString("base64url") : undefined;
		const rows: ClientRow[] = await this.dataSource.query(
			`INSERT INTO "oidc_clients" ("id", "name", "redirect_uris", "secret_encrypted")
			 VALUES ($1, $2, $3::jsonb, $4)
			 RETURNING "id", "name", "redirect_uris", "secret_encrypted" IS NOT NULL AS "confidential", "resource_scopes", "created_at"`,
			[id, name, JSON.stringify(request.redirectUris), secret ? encryptOidcSecret(secret) : null],
		);
		return { ...publicClient(rows[0]), ...(secret ? { secret } : {}) };
	}

	async setResourceScopes(id: string, scopes: string[]): Promise<void> {
		if (!Array.isArray(scopes) || scopes.some((scope) => typeof scope !== "string" || !isOidcResourceScope(scope)) || new Set(scopes).size !== scopes.length) throw new BadRequest("Invalid resource permissions.");
		await this.dataSource.transaction(async (manager) => {
			const rows: Array<{ resource_scopes: string[] }> = await manager.query(`SELECT "resource_scopes" FROM "oidc_clients" WHERE "id" = $1 FOR UPDATE`, [id]);
			if (!rows.length) throw new NotFound("OAuth client not found.");
			const removed = rows[0].resource_scopes.filter((scope) => !scopes.includes(scope));
			await manager.query(`UPDATE "oidc_clients" SET "resource_scopes" = $2::text[] WHERE "id" = $1`, [id, scopes]);
			if (removed.length) {
				await manager.query(`UPDATE "oidc_consents" SET "scopes" = ARRAY(SELECT unnest("scopes") EXCEPT SELECT unnest($2::text[])) WHERE "client_id" = $1`, [id, removed]);
				await manager.query(`DELETE FROM "oidc_artifacts" WHERE "payload"->>'clientId' = $1 OR "payload"->>'grantId' IN (SELECT id FROM "oidc_artifacts" WHERE kind = 'Grant' AND "payload"->>'clientId' = $1)`, [id]);
			}
		});
	}

	async remove(id: string): Promise<void> {
		await this.dataSource.transaction(async (manager) => {
			const rows: Array<{ id: string }> = await manager.query(`DELETE FROM "oidc_clients" WHERE "id" = $1 RETURNING "id"`, [id]);
			if (!rows.length) throw new NotFound("OAuth client not found.");
			await manager.query(`DELETE FROM "oidc_artifacts" WHERE "payload"->>'clientId' = $1`, [id]);
		});
	}
}
