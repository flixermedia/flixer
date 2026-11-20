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

		const query = dataSource.getRepository(OidcArtifact).createQueryBuilder("artifact").select("artifact.payload", "payload").where("artifact.kind = :kind", { kind });
		if (column === "id") query.andWhere("artifact.id = :value", { value });
		else query.andWhere(`artifact.payload ->> '${column}' = :value`, { value });
		return (await query.andWhere("(artifact.expiresAt IS NULL OR artifact.expiresAt > now())").take(1).getRawOne<ArtifactRow>())?.payload;

	}

	return {
		async upsert(id, payload, expiresIn) {
			if (kind === "ReplayDetection") {
				const result = await dataSource
					.getRepository(OidcArtifact)
					.createQueryBuilder()
					.insert()
					.values({ kind, id, payload: payload as never, expiresAt: () => "now() + CAST(:expiresIn AS integer) * interval '1 second'" })
					.setParameter("expiresIn", expiresIn ?? 3600)
					.orUpdate(["payload", "expires_at"], ["kind", "id"], { overwriteCondition: { where: '"expires_at" <= now()' } })
					.returning(["id"])
					.execute();
				if (!result.raw.length) throw new Error("OAuth replay detected.");
				return;
			}
			await dataSource
				.getRepository(OidcArtifact)
				.createQueryBuilder()
				.insert()
				.values({ kind, id, payload: payload as never, expiresAt: () => "CASE WHEN CAST(:expiresIn AS integer) IS NULL THEN NULL ELSE now() + CAST(:expiresIn AS integer) * interval '1 second' END" })
				.setParameter("expiresIn", expiresIn ?? null)
				.orUpdate(["payload", "expires_at"], ["kind", "id"])
				.execute();
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
			// RAW SQL: PostgreSQL JSONB mutation and presence operator keep consume atomic.
			const result = await dataSource
				.getRepository(OidcArtifact)
				.createQueryBuilder()
				.update(OidcArtifact)
				.set({ payload: () => `jsonb_set("payload", '{consumed}', to_jsonb(floor(extract(epoch from now()))::bigint))` })
				.where('"kind" = :kind AND "id" = :id AND NOT ("payload" ? \'consumed\') AND ("expires_at" IS NULL OR "expires_at" > now())', { kind, id })
				.execute();
			if (!result.affected) throw new Error("The OAuth artifact was already consumed or expired.");
		},
		async destroy(id) {
			await dataSource.getRepository(OidcArtifact).delete({ kind, id });
		},
		async revokeByGrantId(grantId) {
			// RAW SQL: PostgreSQL JSONB ->> payload predicate.
			await dataSource.getRepository(OidcArtifact).createQueryBuilder().delete().from(OidcArtifact).where("\"payload\"->>'grantId' = :grantId", { grantId }).execute();
		},
	};

}
