import type { Adapter, AdapterPayload } from "oidc-provider";
import type { DataSource } from "typeorm";
import { OidcArtifact, OidcClient } from "../../entities/oidc.entity.js";
import { decryptOidcSecret } from "./oidcSecrets.js";

interface ArtifactRow {
	payload: AdapterPayload;
}

/** PostgreSQL-backed storage for OpenID Connect clients and provider artifacts. */
export function createOidcAdapter(dataSource: DataSource, kind: string): Adapter {

	async function findArtifact(column: "id" | "uid" | "userCode", value: string): Promise<AdapterPayload | undefined> {

		const predicate = column === "id" ? `"id" = $2` : `"payload"->>'${column}' = $2`;
		// RAW SQL: jsonb ->> payload key lookup (uid/userCode use the expression indexes) with database-clock expiry check
		const rows: ArtifactRow[] = await dataSource.query(`SELECT "payload" FROM "oidc_artifacts" WHERE "kind" = $1 AND ${predicate} AND ("expires_at" IS NULL OR "expires_at" > now()) LIMIT 1`, [kind, value]);
		return rows[0]?.payload;

	}

	return {
		async upsert(id, payload, expiresIn) {
			if (kind === "ReplayDetection") {
				// RAW SQL: atomic INSERT ... ON CONFLICT ... WHERE ... RETURNING detects replays in one statement
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
			// RAW SQL: upsert computing expires_at from the database clock (now() + interval) with a NULL-able lifetime
			await dataSource.query(
				`INSERT INTO "oidc_artifacts" ("kind", "id", "payload", "expires_at")
				 VALUES ($1, $2, $3::jsonb, CASE WHEN $4::integer IS NULL THEN NULL ELSE now() + $4 * interval '1 second' END)
				 ON CONFLICT ("kind", "id") DO UPDATE SET "payload" = EXCLUDED."payload", "expires_at" = EXCLUDED."expires_at"`,
				[kind, id, JSON.stringify(payload), expiresIn ?? null],
			);
		},
		async find(id) {
			if (kind !== "Client") return findArtifact("id", id);
			const client = await dataSource.getRepository(OidcClient).findOne({ select: { id: true, name: true, redirectUris: true, secretEncrypted: true }, where: { id } });
			if (!client) return undefined;
			return {
				client_id: client.id,
				client_name: client.name,
				redirect_uris: client.redirectUris,
				response_types: ["code"],
				grant_types: ["authorization_code", "refresh_token"],
				scope: "openid profile email offline_access roles groups",
				token_endpoint_auth_method: client.secretEncrypted ? "client_secret_basic" : "none",
				...(client.secretEncrypted ? { client_secret: decryptOidcSecret(client.secretEncrypted) } : {}),
			};
		},
		findByUserCode: (code) => findArtifact("userCode", code),
		findByUid: (uid) => findArtifact("uid", uid),
		async consume(id) {
			// RAW SQL: atomic UPDATE ... jsonb_set ... RETURNING consumes an artifact exactly once
			const rows: Array<{ id: string }> = await dataSource.query(
				`UPDATE "oidc_artifacts" SET "payload" = jsonb_set("payload", '{consumed}', to_jsonb(floor(extract(epoch from now()))::bigint))
				 WHERE "kind" = $1 AND "id" = $2 AND NOT ("payload" ? 'consumed') AND ("expires_at" IS NULL OR "expires_at" > now()) RETURNING "id"`,
				[kind, id],
			);
			if (!rows.length) throw new Error("The OAuth artifact was already consumed or expired.");
		},
		async destroy(id) {
			await dataSource.getRepository(OidcArtifact).delete({ kind, id });
		},
		async revokeByGrantId(grantId) {
			// RAW SQL: delete by jsonb ->> payload predicate
			await dataSource.query(`DELETE FROM "oidc_artifacts" WHERE "payload"->>'grantId' = $1`, [grantId]);
		},
	};

}
