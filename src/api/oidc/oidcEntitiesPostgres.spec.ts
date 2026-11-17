// Runs the entity-backed OIDC calls against a migrated throwaway schema:
//   OIDC_TEST_DATABASE_URL=postgres://... npx vitest run src/api/oidc/oidcEntitiesPostgres.spec.ts
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DataSource } from "typeorm";
import { ENTITIES } from "../../datasources/entityList.js";
import { MIGRATIONS } from "../../datasources/migrationList.js";
import { OidcArtifact, OidcConfig, OidcConsent } from "../../entities/oidc.entity.js";
import { User } from "../../entities/user.entity.js";
import { cleanupExpiredOidcArtifacts } from "./oidcCleanup.js";
import { createOidcAdapter } from "./oidcAdapter.js";
import { OidcClientService } from "./oidcClientService.js";
import { OidcConsentService } from "./oidcConsentService.js";
import { OidcProviderService } from "./oidcProviderService.js";

const databaseUrl = process.env.OIDC_TEST_DATABASE_URL;

describe.skipIf(!databaseUrl)("OIDC entity-backed queries with PostgreSQL", () => {
	const schema = `oidc_entities_test_${randomUUID().replaceAll("-", "")}`;
	const userId = randomUUID();
	let admin: DataSource;
	let db: DataSource;
	let clients: OidcClientService;
	let consents: OidcConsentService;
	let previousSecret: string | undefined;

	beforeAll(async () => {
		previousSecret = process.env.JWT_SECRET;
		process.env.JWT_SECRET = "test-only-signing-secret-12345678901234567890";
		admin = new DataSource({ type: "postgres", url: databaseUrl });
		await admin.initialize();
		await admin.query(`CREATE SCHEMA "${schema}"`);
		db = new DataSource({ type: "postgres", url: databaseUrl, extra: { options: `-c search_path=${schema}` }, schema, entities: ENTITIES, migrations: MIGRATIONS, synchronize: false });
		await db.initialize();
		await db.runMigrations();
		await db.getRepository(User).save({ id: userId, username: "oidc-entities", passwordHash: "unused" });
		clients = new OidcClientService(db);
		consents = new OidcConsentService(db);
	});

	afterAll(async () => {
		if (previousSecret === undefined) delete process.env.JWT_SECRET;
		else process.env.JWT_SECRET = previousSecret;
		if (db?.isInitialized) await db.destroy();
		if (admin?.isInitialized) {
			await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
			await admin.destroy();
		}
	});

	it("creates and lists clients with database defaults, newest first", async () => {
		const publicClient = await clients.create({ name: "Public app", type: "public", redirectUris: ["https://public.example/callback"] });
		expect(publicClient).toMatchObject({ name: "Public app", redirectUris: ["https://public.example/callback"], type: "public", resourceScopes: [] });
		expect(publicClient.createdAt).toBeInstanceOf(Date);
		expect(publicClient).not.toHaveProperty("secret");
		const confidential = await clients.create({ name: "Confidential app", type: "confidential", redirectUris: ["https://conf.example/callback"] });
		expect(confidential.secret).toEqual(expect.any(String));
		expect(await db.query(`SELECT secret_encrypted IS NOT NULL AS stored FROM oidc_clients WHERE id = $1`, [confidential.id])).toEqual([{ stored: true }]);

		const listed = await clients.list();
		expect(listed.map((client) => client.id)).toEqual([confidential.id, publicClient.id]);
		expect(listed[0]).toEqual({ id: confidential.id, name: "Confidential app", redirectUris: ["https://conf.example/callback"], type: "confidential", resourceScopes: [], createdAt: expect.any(Date) });
		expect(listed[0]).not.toHaveProperty("secret");
	});

	it("loads registered clients through the adapter and deletes artifacts by key", async () => {
		const client = await clients.create({ name: "Adapter app", type: "confidential", redirectUris: ["https://adapter.example/callback"] });
		const clientAdapter = createOidcAdapter(db, "Client");
		expect(await clientAdapter.find(client.id)).toMatchObject({ client_id: client.id, client_name: "Adapter app", redirect_uris: ["https://adapter.example/callback"], token_endpoint_auth_method: "client_secret_basic", client_secret: client.secret });
		expect(await clientAdapter.find("missing")).toBeUndefined();

		const sessions = createOidcAdapter(db, "Session");
		await sessions.upsert("session-1", { uid: "u1" }, 60);
		expect(await sessions.find("session-1")).toEqual({ uid: "u1" });
		await sessions.destroy("session-1");
		expect(await sessions.find("session-1")).toBeUndefined();
	});

	it("updates resource scopes and removes clients with NotFound on a missing id", async () => {
		const client = await clients.create({ name: "Scopes app", type: "public", redirectUris: ["https://scopes.example/callback"] });
		await clients.setResourceScopes(client.id, ["subscriptions:read"]);
		expect(await db.query(`SELECT resource_scopes FROM oidc_clients WHERE id = $1`, [client.id])).toEqual([{ resource_scopes: ["subscriptions:read"] }]);
		await clients.setResourceScopes(client.id, []);
		expect(await db.query(`SELECT resource_scopes FROM oidc_clients WHERE id = $1`, [client.id])).toEqual([{ resource_scopes: [] }]);

		await clients.remove(client.id);
		await expect(clients.remove(client.id)).rejects.toThrow("OAuth client not found.");
		await expect(clients.setResourceScopes(client.id, [])).rejects.toThrow("OAuth client not found.");
	});

	it("lists consents ordered by client name then id and revokes by key", async () => {
		const b = await clients.create({ name: "Bravo", type: "public", redirectUris: ["https://b.example/callback"] });
		const a = await clients.create({ name: "Alpha", type: "public", redirectUris: ["https://a.example/callback"] });
		const sameName = await clients.create({ name: "Alpha", type: "public", redirectUris: ["https://a2.example/callback"] });
		const [first, second] = [a.id, sameName.id].sort();
		await db.getRepository(OidcConsent).save([
			{ accountId: userId, clientId: b.id, scopes: ["openid", "profile"], claims: [] },
			{ accountId: userId, clientId: second, scopes: ["openid"], claims: [] },
			{ accountId: userId, clientId: first, scopes: ["openid", "email"], claims: ["email"] },
		]);
		expect(await consents.list(userId)).toEqual([
			{ id: first, name: "Alpha", scopes: ["openid", "email"] },
			{ id: second, name: "Alpha", scopes: ["openid"] },
			{ id: b.id, name: "Bravo", scopes: ["openid", "profile"] },
		]);
		expect(await consents.list(randomUUID())).toEqual([]);

		await db.getRepository(OidcArtifact).save({ kind: "Grant", id: "revoked-grant", payload: { accountId: userId, clientId: b.id }, expiresAt: null });
		await consents.revoke(userId, b.id);
		expect((await consents.list(userId)).map((consent) => consent.id)).toEqual([first, second]);
		expect(await db.getRepository(OidcArtifact).findOneBy({ kind: "Grant", id: "revoked-grant" })).toBeNull();
		await consents.revoke(userId, b.id);
	});

	it("reads and upserts the public origin and creates one signing key", async () => {
		const service = new OidcProviderService(db);
		expect(await service.getConfiguration()).toEqual({ publicUrl: "", issuer: "" });
		await service.setPublicUrl("https://one.example/");
		await service.setPublicUrl("https://two.example");
		expect(await service.getConfiguration()).toEqual({ publicUrl: "https://two.example", issuer: "https://two.example/api/oidc" });
		expect(await db.getRepository(OidcConfig).countBy({ key: "public_origin" })).toBe(1);

		const [first, second] = await Promise.all([service["signingKeys"](), service["signingKeys"]()]);
		expect(first.keys).toHaveLength(1);
		expect(second.keys).toHaveLength(1);
		expect(await db.getRepository(OidcConfig).countBy({ key: "signing_key" })).toBe(1);
		expect(second.keys[0]).toEqual(first.keys[0]);
	});

	it("deletes only expired artifacts during cleanup", async () => {
		await db.query(`INSERT INTO oidc_artifacts (kind, id, payload, expires_at) VALUES ('Session', 'expired', '{}', now() - interval '1 minute'), ('Session', 'live', '{}', now() + interval '1 hour'), ('Grant', 'forever', '{}', NULL)`);
		await cleanupExpiredOidcArtifacts(db);
		expect(await db.query(`SELECT id FROM oidc_artifacts WHERE id IN ('expired', 'live', 'forever') ORDER BY id`)).toEqual([{ id: "forever" }, { id: "live" }]);
	});
});
