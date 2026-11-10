import type { Adapter, AdapterPayload } from "oidc-provider";
import type { DataSource } from "typeorm";
import { decryptOidcSecret } from "./oidcSecrets.js";

interface ClientRow {
	id: string;
	name: string;
	redirect_uris: string[];
	secret_encrypted: string | null;
	share_subscription: boolean;
	resource_scopes: string[];
}

interface ArtifactRow {
	payload: AdapterPayload;
}

/** PostgreSQL-backed storage for OpenID Connect clients and provider artifacts. */
export function createOidcAdapter(dataSource: DataSource, kind: string): Adapter {
	async function findArtifact(column: "id" | "uid" | "userCode", value: string): Promise<AdapterPayload | undefined> {
		const predicate = column === "id" ? `"id" = $2` : `"payload"->>'${column}' = $2`;
		const rows: ArtifactRow[] = await dataSource.query(
			`SELECT "payload" FROM "oidc_artifacts" WHERE "kind" = $1 AND ${predicate} AND ("expires_at" IS NULL OR "expires_at" > now()) LIMIT 1`,
			[kind, value],
		);
		return rows[0]?.payload;
	}

	return {
		async upsert(id, payload, expiresIn) {
			if (kind === "ReplayDetection") {
				const rows: Array<{ id: string }> = await dataSource.query(
					`INSERT INTO "oidc_artifacts" ("kind", "id", "payload", "expires_at")
					 VALUES ($1, $2, $3::jsonb, now() + $4 * interval '1 second')
					 ON CONFLICT ("kind", "id") DO UPDATE SET "payload" = EXCLUDED."payload", "expires_at" = EXCLUDED."expires_at"
					 WHERE "oidc_artifacts"."expires_at" <= now() RETURNING "id"`,
					[kind, id, JSON.stringify(payload), expiresIn ?? 3600],
				);
				if (!rows.length) throw new Error("OAuth replay detected.");
				return;
			}
			await dataSource.query(
				`INSERT INTO "oidc_artifacts" ("kind", "id", "payload", "expires_at")
				 VALUES ($1, $2, $3::jsonb, CASE WHEN $4::integer IS NULL THEN NULL ELSE now() + $4 * interval '1 second' END)
				 ON CONFLICT ("kind", "id") DO UPDATE SET "payload" = EXCLUDED."payload", "expires_at" = EXCLUDED."expires_at"`,
				[kind, id, JSON.stringify(payload), expiresIn ?? null],
			);
		},
		async find(id) {
			if (kind !== "Client") return findArtifact("id", id);
			const rows: ClientRow[] = await dataSource.query(`SELECT "id", "name", "redirect_uris", "secret_encrypted", "share_subscription", "resource_scopes" FROM "oidc_clients" WHERE "id" = $1`, [id]);
			const client = rows[0];
			if (!client) return undefined;
			return {
				client_id: client.id,
				client_name: client.name,
				redirect_uris: client.redirect_uris,
				response_types: ["code"],
				grant_types: ["authorization_code", "refresh_token"],
				scope: `openid profile email offline_access roles groups${client.share_subscription ? " subscription" : ""}`,
				token_endpoint_auth_method: client.secret_encrypted ? "client_secret_basic" : "none",
				...(client.secret_encrypted ? { client_secret: decryptOidcSecret(client.secret_encrypted) } : {}),
			};
		},
		findByUserCode: (code) => findArtifact("userCode", code),
		findByUid: (uid) => findArtifact("uid", uid),
		async consume(id) {
			const rows: Array<{ id: string }> = await dataSource.query(
				`UPDATE "oidc_artifacts" SET "payload" = jsonb_set("payload", '{consumed}', to_jsonb(floor(extract(epoch from now()))::bigint))
				 WHERE "kind" = $1 AND "id" = $2 AND NOT ("payload" ? 'consumed') AND ("expires_at" IS NULL OR "expires_at" > now()) RETURNING "id"`,
				[kind, id],
			);
			if (!rows.length) throw new Error("The OAuth artifact was already consumed or expired.");
		},
		async destroy(id) {
			await dataSource.query(`DELETE FROM "oidc_artifacts" WHERE "kind" = $1 AND "id" = $2`, [kind, id]);
		},
		async revokeByGrantId(grantId) {
			await dataSource.query(`DELETE FROM "oidc_artifacts" WHERE "payload"->>'grantId' = $1`, [grantId]);
		},
	};
}
