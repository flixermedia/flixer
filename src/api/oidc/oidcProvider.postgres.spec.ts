import { createHash, createPublicKey, randomBytes, randomUUID, verify } from "node:crypto";
import Fastify from "fastify";
import middie from "@fastify/middie";
import type { PlatformContext } from "@tsed/platform-http";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { DataSource } from "typeorm";
import { User } from "../../entities/user.entity.js";
import { UserPreference } from "../../entities/userPreference.entity.js";
import { PaymentSubscription } from "../../entities/paymentSubscription.entity.js";
import { PaymentPlan } from "../../entities/paymentPlan.entity.js";
import { PaymentEntitlement } from "../../entities/paymentEntitlement.entity.js";
import { PaymentOrder } from "../../entities/paymentOrder.entity.js";
import { MediaItem } from "../../entities/mediaItem.entity.js";
import { Favorite } from "../../entities/favorite.entity.js";
import { Playlist } from "../../entities/playlist.entity.js";
import { PlaylistItem } from "../../entities/playlistItem.entity.js";
import { WatchProgress } from "../../entities/watchProgress.entity.js";
import { ListeningHistory } from "../../entities/listeningHistory.entity.js";
import { CreateOidcProvider1798300000015 } from "../../migrations/createOidcProvider1798300000015.js";
import { CreateOidcConsents1798300000017 } from "../../migrations/createOidcConsents1798300000017.js";
import { AddOidcSubscriptionSharing1798300000018 } from "../../migrations/addOidcSubscriptionSharing1798300000018.js";
import { AddOidcResourceScopes1798300000019 } from "../../migrations/addOidcResourceScopes1798300000019.js";
import { RemoveOidcSubscriptionClaim1798300000020 } from "../../migrations/removeOidcSubscriptionClaim1798300000020.js";
import { OidcClientService } from "./oidcClientService.js";
import { OidcProviderService } from "./oidcProviderService.js";
import { OidcInteractionController } from "./oidcInteractionController.js";
import { OidcConsentService } from "./oidcConsentService.js";
import { OidcConsentsController } from "./oidcConsentsController.js";
import { OidcResourceController } from "./oidcResourceController.js";
import type { MediaAccessService } from "../access/mediaAccessService.js";
import type { EntitlementService } from "../payments/entitlementService.js";
import { OIDC_RESOURCE_SCOPES } from "./oidcResourceScopes.js";
import { Unauthorized } from "@tsed/exceptions";
import type { AuthService } from "../auth/authService.js";

const databaseUrl = process.env.OIDC_TEST_DATABASE_URL;

describe.skipIf(!databaseUrl)("OpenID Connect with PostgreSQL", () => {
	const schema = `oidc_test_${randomUUID().replaceAll("-", "")}`;
	let admin: DataSource;
	let db: DataSource;
	let app: ReturnType<typeof Fastify>;
	let clients: OidcClientService;
	let issuer: string;
	let service: OidcProviderService;
	let previousSecret: string | undefined;
	const userId = randomUUID();
	const otherUserId = randomUUID();
	const importedUserId = randomUUID();
	let activeUserId = userId;

	beforeAll(async () => {
		previousSecret = process.env.JWT_SECRET;
		process.env.JWT_SECRET = "test-only-signing-secret-12345678901234567890";
		admin = new DataSource({ type: "postgres", url: databaseUrl });
		await admin.initialize();
		await admin.query(`CREATE SCHEMA "${schema}"`);
		db = new DataSource({ type: "postgres", url: databaseUrl, extra: { options: `-c search_path=${schema}` }, entities: [User, UserPreference, PaymentSubscription, PaymentPlan, PaymentEntitlement, PaymentOrder, MediaItem, Favorite, Playlist, PlaylistItem, WatchProgress, ListeningHistory], synchronize: true });
		await db.initialize();
		const runner = db.createQueryRunner();
		try {
			await new CreateOidcProvider1798300000015().up(runner);
			await db.getRepository(User).save({ id: importedUserId, username: "importeduser", passwordHash: "unused" });
			await db.query(`INSERT INTO oidc_clients (id, name, redirect_uris) VALUES ('imported-client', 'Imported', '["https://client.example/callback"]')`);
			const insertGrant = (id: string, openid: object, rejected: object, expiry: string, accountId = importedUserId) => db.query(`INSERT INTO oidc_artifacts (kind, id, payload, expires_at) VALUES ('Grant', $1, $2::jsonb, now() + $3::interval)`, [id, JSON.stringify({ accountId, clientId: "imported-client", openid, rejected }), expiry]);
			await insertGrant("imported-1", { scope: "openid profile email rejected", claims: ["name", "email", "rejected"] }, { openid: { scope: "email rejected", claims: ["email", "rejected"] } }, "1 day");
			await insertGrant("imported-2", { scope: "openid email", claims: ["email"] }, {}, "1 day");
			await insertGrant("expired", { scope: "openid expired", claims: ["expired"] }, {}, "-1 day");
			await insertGrant("missing-user", { scope: "openid unknown", claims: [] }, {}, "1 day", randomUUID());
			await new CreateOidcConsents1798300000017().up(runner);
			await new AddOidcSubscriptionSharing1798300000018().up(runner);
			await new AddOidcResourceScopes1798300000019().up(runner);
			await db.query(`INSERT INTO oidc_clients (id, name, redirect_uris, share_subscription) VALUES ('legacy-client', 'Legacy', '["https://client.example/callback"]', true)`);
			await db.query(`INSERT INTO oidc_consents (account_id, client_id, scopes, claims) VALUES ($1, 'legacy-client', ARRAY['openid', 'subscription', 'subscriptions:read'], ARRAY['flixer_subscription_active', 'name'])`, [importedUserId]);
			await db.query(`INSERT INTO oidc_artifacts (kind, id, payload) VALUES ('Grant', 'legacy-grant', '{"clientId":"legacy-client"}'), ('AccessToken', 'legacy-token', '{"grantId":"legacy-grant"}')`);
			await new RemoveOidcSubscriptionClaim1798300000020().up(runner);
			expect(await db.query(`SELECT scopes, claims FROM oidc_consents WHERE client_id = 'legacy-client'`)).toEqual([{ scopes: ["openid", "subscriptions:read"], claims: ["name"] }]);
			expect(await db.query(`SELECT id FROM oidc_artifacts WHERE id IN ('legacy-grant', 'legacy-token')`)).toEqual([]);
			expect(await db.query(`SELECT id FROM oidc_artifacts WHERE id = 'imported-1'`)).toHaveLength(1);
			await db.query(`DELETE FROM oidc_clients WHERE id = 'legacy-client'`);
		} finally {
			await runner.release();
		}
		await db.getRepository(User).save({ id: userId, username: "testuser", displayName: "Test User", email: "test@example.org", emailVerifiedAt: new Date(), passwordHash: "unused" });
		await db.getRepository(User).save({ id: otherUserId, username: "otheruser", passwordHash: "unused" });
		clients = new OidcClientService(db);
		app = Fastify();
		await app.register(middie);
		let interactionController: OidcInteractionController;
		let consentsController: OidcConsentsController;
		let resourceController: OidcResourceController;
		app.use("/api/oidc", (req, res, next) => {
			if (/^\/interaction(?:\/|$)/.test(req.url || "")) return next();
			void service
				.getProvider()
				.then((provider) => provider.callback()(req, res))
				.catch(next);
		});
		app.get<{ Params: { uid: string } }>("/api/oidc/interaction/:uid/details", async (req, reply) => {
			const ctx = { request: { req: req.raw }, response: { res: reply.raw, setHeader: (name: string, value: string) => reply.header(name, value) } } as unknown as PlatformContext;
			return interactionController.details(req.params.uid, "Bearer test", ctx);
		});
		app.get<{ Params: { uid: string } }>("/api/oidc/interaction/:uid/client", async (req, reply) => {
			const ctx = { request: { req: req.raw }, response: { res: reply.raw, setHeader: (name: string, value: string) => reply.header(name, value) } } as unknown as PlatformContext;
			return interactionController.client(req.params.uid, ctx);
		});
		app.post<{ Params: { uid: string }; Body: { action: "login" | "approve" | "deny" } }>("/api/oidc/interaction/:uid", async (req, reply) => {
			const ctx = { request: { req: req.raw }, response: { res: reply.raw, setHeader: (name: string, value: string) => reply.header(name, value) } } as unknown as PlatformContext;
			return interactionController.decide(req.params.uid, req.body, "Bearer test", ctx);
		});
		app.get("/api/account/oidc-apps", async (req, reply) => {
			const ctx = { response: { setHeader: (name: string, value: string) => reply.header(name, value) } } as PlatformContext;
			return consentsController.list(req.headers.authorization, ctx);
		});
		app.delete<{ Params: { id: string } }>("/api/account/oidc-apps/:id", async (req, reply) => {
			await consentsController.revoke(req.params.id, req.headers.authorization);
			reply.code(204).send();
		});
		app.get("/api/oauth/me/subscriptions", async (req, reply) => {
			const ctx = { response: { setHeader: (name: string, value: string) => reply.header(name, value) } } as PlatformContext;
			return resourceController.subscriptions(req.headers.authorization, undefined, undefined, ctx);
		});
		app.get("/api/oauth/me/preferences", async (req, reply) => {
			const ctx = { response: { setHeader: (name: string, value: string) => reply.header(name, value) } } as PlatformContext;
			return resourceController.preferences(req.headers.authorization, ctx);
		});
		await app.listen({ port: 0, host: "127.0.0.1" });
		const address = app.server.address();
		if (!address || typeof address === "string") throw new Error("Missing test server address");
		service = new OidcProviderService(db);
		expect(await service.getConfiguration()).toEqual({ publicUrl: "", issuer: "" });
		const configuration = await service.setPublicUrl(`http://localhost:${address.port}`);
		issuer = configuration.issuer;
		await service.getProvider();
		const auth = { requireAuthenticatedSession: async (authorization?: string) => {
			if (!authorization) throw new Unauthorized("Authentication required.");
			return { user: { id: activeUserId, username: "testuser" } };
		} } as AuthService;
		interactionController = new OidcInteractionController(auth, service, db);
		consentsController = new OidcConsentsController(auth, new OidcConsentService(db));
		resourceController = new OidcResourceController(db, service, {
			forUser: async () => ({ enforced: false }),
			visibleIds: async (_policy: unknown, ids: string[]) => new Set(ids),
			blockReason: async () => null,
			restrictionSql: () => ({ sql: "TRUE", params: {} }),
		} as unknown as MediaAccessService, {
			contextFor: async (id: string) => ({ ids: [id], kind: "movies", artists: [] }),
			lockState: async () => ({ locked: false }),
		} as EntitlementService);
	}, 30_000);

	afterAll(async () => {
		if (app) await app.close();
		if (db?.isInitialized) await db.destroy();
		if (admin?.isInitialized) {
			await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
			await admin.destroy();
		}
		if (previousSecret === undefined) delete process.env.JWT_SECRET;
		else process.env.JWT_SECRET = previousSecret;
	});

	it("requires an audience-bound token, current client permission and user approval for resource access", async () => {
		const client = await clients.create({ name: "Resource client", type: "public", redirectUris: ["https://client.example/callback"] });
		const agent = request.agent(app.server);
		const verifier = randomBytes(32).toString("base64url");
		const resource = `${issuer}/resource`;
		const query = { client_id: client.id, response_type: "code", redirect_uri: "https://client.example/callback", scope: "openid offline_access subscriptions:read", resource, prompt: "consent", code_challenge_method: "S256", code_challenge: createHash("sha256").update(verifier).digest("base64url") };
		const denied = await agent.get("/api/oidc/auth").query(query).expect(303);
		expect(new URL(denied.headers.location, issuer).searchParams.get("error")).toBe("invalid_scope");
		await clients.setResourceScopes(client.id, ["subscriptions:read"]);
		const authorization = await agent.get("/api/oidc/auth").query(query).expect(303);
		const login = await agent.post(new URL(authorization.headers.location, issuer).pathname).send({ action: "login" }).expect(200);
		let resume = new URL(login.body.redirect);
		const consent = await agent.get(`${resume.pathname}${resume.search}`).expect(303);
		const consentPath = new URL(consent.headers.location, issuer).pathname;
		expect((await agent.get(`${consentPath}/details`).expect(200)).body.scope).toContain("subscriptions:read");
		const approval = await agent.post(consentPath).send({ action: "approve" }).expect(200);
		resume = new URL(approval.body.redirect);
		const callback = await agent.get(`${resume.pathname}${resume.search}`).expect(303);
		const code = new URL(callback.headers.location).searchParams.get("code");
		const token = await agent.post("/api/oidc/token").type("form").send({ grant_type: "authorization_code", client_id: client.id, code, redirect_uri: query.redirect_uri, code_verifier: verifier, resource }).expect(200);
		const bearer = { Authorization: `Bearer ${token.body.access_token}` };
		expect((await agent.get("/api/oauth/me/subscriptions").set(bearer).expect(200)).body).toEqual({ items: [], nextOffset: null });
		await agent.get("/api/oauth/me/preferences").set(bearer).expect(403);
		await agent.get("/api/oidc/me").set(bearer).expect(403);
		const refreshed = await agent.post("/api/oidc/token").type("form").send({ grant_type: "refresh_token", client_id: client.id, refresh_token: token.body.refresh_token, resource }).expect(200);
		expect(refreshed.body.refresh_token).not.toBe(token.body.refresh_token);
		await agent.get("/api/oauth/me/subscriptions").set("Authorization", `Bearer ${refreshed.body.access_token}`).expect(200);
		expect((await new OidcConsentService(db).list(userId)).find((item) => item.id === client.id)?.scopes).toContain("subscriptions:read");
		await clients.setResourceScopes(client.id, []);
		await agent.get("/api/oauth/me/subscriptions").set(bearer).expect(401);
		await agent.post("/api/oidc/token").type("form").send({ grant_type: "refresh_token", client_id: client.id, refresh_token: refreshed.body.refresh_token, resource }).expect(400);
		await clients.remove(client.id);
	}, 15_000);

	it("returns paginated, scoped account data without exposing another account", async () => {
		const client = await clients.create({ name: "All resources", type: "public", redirectUris: ["https://client.example/callback"] });
		await clients.setResourceScopes(client.id, [...OIDC_RESOURCE_SCOPES]);
		const provider = await service.getProvider();
		const resource = `${issuer}/resource`;
		const grant = new provider.Grant({ accountId: userId, clientId: client.id });
		grant.addResourceScope(resource, [...OIDC_RESOURCE_SCOPES]);
		const grantId = await grant.save();
		await db.query(`INSERT INTO oidc_consents (account_id, client_id, scopes, claims) VALUES ($1, $2, $3::text[], ARRAY[]::text[])`, [userId, client.id, [...OIDC_RESOURCE_SCOPES]]);
		const providerClient = await provider.Client.find(client.id);
		if (!providerClient) throw new Error("Missing test client");
		const token = new provider.AccessToken({ client: providerClient, accountId: userId, grantId, gty: "authorization_code", aud: resource, scope: OIDC_RESOURCE_SCOPES.join(" ") });
		const bearer = `Bearer ${await token.save()}`;
		const wrongAudience = new provider.AccessToken({ client: providerClient, accountId: userId, grantId, gty: "authorization_code", scope: OIDC_RESOURCE_SCOPES.join(" ") });
		const ctx = { response: { setHeader: vi.fn() } } as unknown as PlatformContext;
		const blockReason = vi.fn(async (): Promise<"rating" | null> => null);
		const lockState = vi.fn(async () => ({ locked: false }));
		const access = { forUser: async () => ({ enforced: false }), visibleIds: async (_policy: unknown, ids: string[]) => new Set(ids), blockReason, restrictionSql: () => ({ sql: "TRUE", params: {} }) } as unknown as MediaAccessService;
		const entitlement = { contextFor: async (id: string) => ({ ids: [id], kind: "movies", artists: [] }), lockState } as EntitlementService;
		const controller = new OidcResourceController(db, service, access, entitlement);
		const item = randomUUID(), library = randomUUID(), playlist = randomUUID(), plan = randomUUID();
		await db.getRepository(MediaItem).save({ id: item, libraryId: library, title: "Test title", type: "movie", path: "/private/path", externalKey: "test" });
		await db.getRepository(PaymentPlan).save({ id: plan, name: "Plan", interval: "month", scopes: [{ type: "all", ref: null }] });
		const subscription = await db.getRepository(PaymentSubscription).save({ id: randomUUID(), userId, planId: plan, status: "active", currency: "USD", amountMinor: 100, periodEnd: new Date(Date.now() + 60_000) });
		await db.getRepository(PaymentEntitlement).save({ id: randomUUID(), userId, source: "purchase", scope: { type: "item", ref: item } });
		await db.getRepository(PaymentOrder).save({ id: randomUUID(), userId, kind: "purchase", description: "Test order", currency: "USD", subtotalMinor: 100, totalMinor: 100, status: "paid" });
		await db.getRepository(PaymentOrder).save({ id: randomUUID(), userId: otherUserId, kind: "purchase", description: "Other user's order", currency: "USD", subtotalMinor: 100, totalMinor: 100, status: "paid" });
		await db.getRepository(Favorite).save({ userId, itemId: item });
		await db.getRepository(Playlist).save({ id: playlist, userId, name: "My list" });
		await db.getRepository(PlaylistItem).save({ playlistId: playlist, itemId: item, position: 0 });
		await db.getRepository(WatchProgress).save({ userId, itemId: item, positionSeconds: 30 });
		await db.getRepository(ListeningHistory).save({ userId, itemId: item });
		await db.getRepository(UserPreference).save({ userId, data: { language: "en", secret: "not-shared" } });
		expect((await controller.subscriptions(bearer, "1", "0", ctx)).items).toMatchObject([{ planName: "Plan", active: true }]);
		await db.getRepository(PaymentSubscription).update(subscription.id, { periodEnd: new Date(Date.now() - 60_000) });
		expect((await controller.subscriptions(bearer, "1", "0", ctx)).items).toMatchObject([{ active: false }]);
		await db.getRepository(PaymentSubscription).update(subscription.id, { status: "past_due", graceUntil: new Date(Date.now() + 60_000) });
		expect((await controller.subscriptions(bearer, "1", "0", ctx)).items).toMatchObject([{ active: true }]);
		expect((await controller.grants(bearer, undefined, undefined, ctx)).items).toEqual(expect.arrayContaining([expect.objectContaining({ source: "purchase" }), expect.objectContaining({ source: "subscription" })]));
		expect((await controller.purchases(bearer, undefined, undefined, ctx)).items).toMatchObject([{ description: "Test order" }]);
		expect((await controller.purchases(bearer, undefined, undefined, ctx)).items).toHaveLength(1);
		expect(await controller.check(item, bearer, ctx)).toEqual({ allowed: true });
		blockReason.mockResolvedValueOnce("rating");
		expect(await controller.check(item, bearer, ctx)).toEqual({ allowed: false });
		expect(lockState).toHaveBeenCalledTimes(1);
		expect((await controller.library(bearer, undefined, undefined, ctx)).items).toMatchObject([{ id: item, title: "Test title" }]);
		expect((await controller.favorites(bearer, undefined, undefined, ctx)).items).toMatchObject([{ itemId: item }]);
		expect((await controller.playlists(bearer, undefined, undefined, ctx)).items).toMatchObject([{ id: playlist }]);
		expect((await controller.playlistItems(playlist, bearer, undefined, undefined, ctx)).items).toMatchObject([{ itemId: item }]);
		expect((await controller.progress(bearer, undefined, undefined, ctx)).items).toMatchObject([{ itemId: item, positionSeconds: 30 }]);
		expect((await controller.history(bearer, undefined, undefined, ctx)).items).toMatchObject([{ itemId: item }]);
		expect(await controller.preferences(bearer, ctx)).toEqual({ language: "en" });
		await expect(controller.preferences(`Bearer ${await wrongAudience.save()}`, ctx)).rejects.toThrow("Invalid OAuth access token");
		await expect(controller.purchases(bearer, "101", undefined, ctx)).rejects.toThrow("Invalid pagination");
		await db.getRepository(User).update(userId, { disabledAt: new Date() });
		await expect(controller.preferences(bearer, ctx)).rejects.toThrow("The account is unavailable");
		await db.getRepository(User).update(userId, { disabledAt: null });
		await new OidcConsentService(db).revoke(userId, client.id);
		await expect(controller.preferences(bearer, ctx)).rejects.toThrow("Invalid OAuth access token");
		await db.getRepository(PaymentSubscription).delete({ userId });
		await clients.remove(client.id);
	}, 15_000);

	it("imports valid existing approvals, excluding expired and rejected permissions", async () => {
		const rows: Array<{ scopes: string[]; claims: string[] }> = await db.query(`SELECT scopes, claims FROM oidc_consents WHERE account_id = $1 AND client_id = 'imported-client'`, [importedUserId]);
		expect(rows).toHaveLength(1);
		expect(rows[0].scopes.sort()).toEqual(["email", "openid", "profile"]);
		expect(rows[0].claims.sort()).toEqual(["email", "name"]);
		expect(await db.query(`SELECT account_id FROM oidc_consents WHERE account_id <> $1`, [importedUserId])).toEqual([]);
	});

	it.each(["public", "confidential"] as const)("issues rotating refresh tokens and consented claims for a %s client", async (type) => {
		const client = await clients.create({ name: `Claims ${type}`, type, redirectUris: ["https://client.example/callback"] });
		const agent = request.agent(app.server);
		const verifier = randomBytes(32).toString("base64url");
		const challenge = createHash("sha256").update(verifier).digest("base64url");
		const query = { client_id: client.id, response_type: "code", redirect_uri: "https://client.example/callback", scope: "openid offline_access roles groups", prompt: "consent", code_challenge_method: "S256", code_challenge: challenge };
		const authorization = await agent.get("/api/oidc/auth").query(query).expect(303);
		let path = new URL(authorization.headers.location, issuer).pathname;
		const login = await agent.post(path).send({ action: "login" }).expect(200);
		let resume = new URL(login.body.redirect);
		const consentRedirect = await agent.get(`${resume.pathname}${resume.search}`).expect(303);
		path = new URL(consentRedirect.headers.location, issuer).pathname;
		expect((await agent.get(`${path}/details`).expect(200)).body).toMatchObject({ prompt: "consent", scope: query.scope });
		const consent = await agent.post(path).send({ action: "approve" }).expect(200);
		resume = new URL(consent.body.redirect);
		const result = await agent.get(`${resume.pathname}${resume.search}`).expect(303);
		const code = new URL(result.headers.location).searchParams.get("code");
		const tokenRequest = () => {
			const req = agent.post("/api/oidc/token").type("form");
			return client.secret ? req.auth(client.id, client.secret) : req;
		};
		const token = await tokenRequest().send({ grant_type: "authorization_code", client_id: client.id, redirect_uri: query.redirect_uri, code, code_verifier: verifier }).expect(200);
		expect(token.body.refresh_token).toBeTruthy();
		const info = () => agent.get("/api/oidc/me").set("Authorization", `Bearer ${token.body.access_token}`);
		const userInfo = (await info().expect(200)).body;
		expect(userInfo).toMatchObject({ roles: ["user"], groups: ["flixer:user"] });
		expect(userInfo).not.toHaveProperty("flixer_subscription_active");
		await db.getRepository(User).update(userId, { disabledAt: new Date() });
		await tokenRequest().send({ grant_type: "refresh_token", client_id: client.id, refresh_token: token.body.refresh_token }).expect(400);
		await db.getRepository(User).update(userId, { disabledAt: null });
		const refreshed = await tokenRequest().send({ grant_type: "refresh_token", client_id: client.id, refresh_token: token.body.refresh_token }).expect(200);
		expect(refreshed.body.refresh_token).toBeTruthy();
		expect(refreshed.body.refresh_token).not.toBe(token.body.refresh_token);
		await tokenRequest().send({ grant_type: "refresh_token", client_id: client.id, refresh_token: token.body.refresh_token }).expect(400);
		await tokenRequest().send({ grant_type: "refresh_token", client_id: client.id, refresh_token: refreshed.body.refresh_token }).expect(400);
		await clients.remove(client.id);
	}, 15_000);


	it("persists admin configuration and reloads the provider when the public URL changes", async () => {
		const secondInstance = new OidcProviderService(db);
		const original = await service.getConfiguration();
		expect(original.issuer).toBe(issuer);
		const first = await service.getProvider();
		expect(await service.getProvider()).toBe(first);
		await expect(service.setPublicUrl("http://insecure.example")).rejects.toThrow();
		await expect(service.setPublicUrl("https://example.com/path")).rejects.toThrow();
		expect(await service.getConfiguration()).toEqual(original);
		await secondInstance.setPublicUrl("https://new.example:8443/");
		expect((await service.getConfiguration()).issuer).toBe("https://new.example:8443/api/oidc");
		expect((await service.getProvider()).issuer).toBe("https://new.example:8443/api/oidc");
		expect((await request(app.server).get("/api/oidc/.well-known/openid-configuration").expect(200)).body.issuer).toBe("https://new.example:8443/api/oidc");
		await secondInstance.setPublicUrl(original.publicUrl);
		expect((await service.getProvider()).issuer).toBe(issuer);
	});

	it("discovers the issuer, validates PKCE and exact registered redirects", async () => {
		const discovery = await request(app.server).get("/api/oidc/.well-known/openid-configuration").expect(200);
		expect(discovery.body.issuer).toBe(issuer);
		expect(discovery.body.code_challenge_methods_supported).toContain("S256");
		expect(discovery.body.scopes_supported).not.toContain("subscription");
		expect(discovery.body.claims_supported).not.toContain("flixer_subscription_active");
		const client = await clients.create({ name: "Example", type: "public", redirectUris: ["https://client.example/callback"] });
		const missingPkce = await request(app.server).get("/api/oidc/auth").query({ client_id: client.id, response_type: "code", redirect_uri: "https://client.example/callback", scope: "openid" });
		expect(missingPkce.headers.location).toContain("error=");
		const badRedirect = await request(app.server)
			.get("/api/oidc/auth")
			.query({ client_id: client.id, response_type: "code", redirect_uri: "https://evil.example/", scope: "openid", code_challenge_method: "S256", code_challenge: createHash("sha256").update(randomBytes(32).toString("base64url")).digest("base64url") });
		expect(badRedirect.status).toBe(302);
		expect(badRedirect.headers.location).toBe("/oauth/error?error=invalid_redirect_uri");
	});

	it("authorizes a user with consent, validates the ID token and prevents code reuse", async () => {
		const client = await clients.create({ name: "Example app", type: "public", redirectUris: ["https://client.example/callback"] });
		const agent = request.agent(app.server);
		const verifier = randomBytes(32).toString("base64url");
		const challenge = createHash("sha256").update(verifier).digest("base64url");
		const authorization = await agent
			.get("/api/oidc/auth")
			.query({
				client_id: client.id,
				response_type: "code",
				redirect_uri: "https://client.example/callback",
				scope: "openid profile email offline_access",
				prompt: "consent",
				state: "test-state",
				nonce: "test-nonce",
				code_challenge_method: "S256",
				code_challenge: challenge,
			})
			.expect(303);
		let interactionPath = new URL(authorization.headers.location, issuer).pathname;
		const publicClient = await agent.get(`${interactionPath}/client`).expect(200);
		expect(publicClient.headers["cache-control"]).toBe("no-store");
		expect(publicClient.body).toEqual({ clientName: "Example app" });
		expect((await request(app.server).get(`${interactionPath}/client`)).status).not.toBe(200);
		const cookies: string[] = authorization.headers["set-cookie"];
		const interactionCookies = cookies.map((value) => value.split(";")[0]).join("; ");
		await request(app.server).get(`/api/oidc/interaction/wrong-id/client`).set("Cookie", interactionCookies).expect(404);
		const loginDetails = await agent.get(`${interactionPath}/details`).expect(200);
		expect(loginDetails.body).toMatchObject({ prompt: "login", clientName: "Example app" });
		const login = await agent.post(interactionPath).send({ action: "login" }).expect(200);
		const resumed = new URL(login.body.redirect);
		const consentRedirect = await agent.get(`${resumed.pathname}${resumed.search}`).expect(303);
		interactionPath = new URL(consentRedirect.headers.location, issuer).pathname;
		const consentDetails = await agent.get(`${interactionPath}/details`).expect(200);
		expect(consentDetails.body).toMatchObject({ prompt: "consent", scope: "openid profile email offline_access" });
		const consent = await agent.post(interactionPath).send({ action: "approve" }).expect(200);
		const consentResume = new URL(consent.body.redirect);
		const result = await agent.get(`${consentResume.pathname}${consentResume.search}`).expect(303);
		const callback = new URL(result.headers.location);
		expect(callback.origin).toBe("https://client.example");
		expect(callback.searchParams.get("state")).toBe("test-state");
		const code = callback.searchParams.get("code");
		expect(code).toBeTruthy();
		const exchange = { grant_type: "authorization_code", client_id: client.id, redirect_uri: "https://client.example/callback", code, code_verifier: verifier };
		const token = await agent.post("/api/oidc/token").type("form").send(exchange).expect(200);
		expect(token.body.refresh_token).toBeTruthy();
		const [header, payload, signature] = token.body.id_token.split(".");
		const discovery = await agent.get("/api/oidc/jwks").expect(200);
		const signingKey = discovery.body.keys.find((item: { kid: string }) => item.kid === JSON.parse(Buffer.from(header, "base64url").toString()).kid);
		expect(verify("RSA-SHA256", Buffer.from(`${header}.${payload}`), createPublicKey({ key: signingKey, format: "jwk" }), Buffer.from(signature, "base64url"))).toBe(true);
		expect(JSON.parse(Buffer.from(payload, "base64url").toString())).toMatchObject({ iss: issuer, aud: client.id, sub: userId, nonce: "test-nonce" });
		const userInfo = await agent.get("/api/oidc/me").set("Authorization", `Bearer ${token.body.access_token}`).expect(200);
		expect(userInfo.body).toMatchObject({ sub: userId, preferred_username: "testuser", email: "test@example.org", email_verified: true });
		await request(app.server).get("/api/account/oidc-apps").expect(401);
		await request(app.server).delete(`/api/account/oidc-apps/${client.id}`).expect(401);
		const apps = await request(app.server).get("/api/account/oidc-apps").set("Authorization", "Bearer test").expect(200);
		expect(apps.headers["cache-control"]).toBe("no-store");
		expect(apps.body).toContainEqual({ id: client.id, name: "Example app", scopes: expect.arrayContaining(["openid", "profile", "email"]) });
		await db.query(`INSERT INTO oidc_consents (account_id, client_id, scopes, claims) VALUES ($1, $2, ARRAY['openid'], ARRAY[]::text[])`, [otherUserId, client.id]);
		const provider = await service.getProvider();
		const otherGrant = new provider.Grant({ accountId: otherUserId, clientId: client.id });
		otherGrant.addOIDCScope("openid");
		const otherGrantId = await otherGrant.save();
		activeUserId = otherUserId;
		expect((await request(app.server).get("/api/account/oidc-apps").set("Authorization", "Bearer test").expect(200)).body).toEqual([{ id: client.id, name: "Example app", scopes: ["openid"] }]);
		activeUserId = userId;
		await agent.post("/api/oidc/token").type("form").send(exchange).expect(400);
		const silent = await agent
			.get("/api/oidc/auth")
			.query({
				client_id: client.id,
				response_type: "code",
				redirect_uri: "https://client.example/callback",
				scope: "openid",
				prompt: "none",
				code_challenge_method: "S256",
				code_challenge: challenge,
			})
			.expect(303);
		expect(["login_required", "interaction_required"]).toContain(new URL(silent.headers.location).searchParams.get("error"));
		const again = await agent
			.get("/api/oidc/auth")
			.query({
				client_id: client.id,
				response_type: "code",
				redirect_uri: "https://client.example/callback",
				scope: "openid",
				code_challenge_method: "S256",
				code_challenge: challenge,
			})
			.expect(303);
		const nextInteraction = new URL(again.headers.location, issuer).pathname;
		expect((await agent.get(`${nextInteraction}/details`).expect(200)).body.prompt).toBe("login");
		const resumedLogin = await agent.post(nextInteraction).send({ action: "login" }).expect(200);
		const resumeUrl = new URL(resumedLogin.body.redirect);
		const pending = await agent.get(`${resumeUrl.pathname}${resumeUrl.search}`).expect(303);
		const pendingCode = new URL(pending.headers.location).searchParams.get("code");
		expect(pendingCode).toBeTruthy();
		await request(app.server).delete(`/api/account/oidc-apps/${client.id}`).set("Authorization", "Bearer test").expect(204);
		await agent.get("/api/oidc/me").set("Authorization", `Bearer ${token.body.access_token}`).expect(401);
		await agent.post("/api/oidc/token").type("form").send({ ...exchange, code: pendingCode }).expect(400);
		await agent.post("/api/oidc/token").type("form").send({ grant_type: "refresh_token", client_id: client.id, refresh_token: token.body.refresh_token }).expect(400);
		expect((await request(app.server).get("/api/account/oidc-apps").set("Authorization", "Bearer test").expect(200)).body).toEqual([]);
		activeUserId = otherUserId;
		expect((await request(app.server).get("/api/account/oidc-apps").set("Authorization", "Bearer test").expect(200)).body).toHaveLength(1);
		expect(await provider.Grant.find(otherGrantId)).toBeDefined();
		activeUserId = userId;
		const retry = await agent.get("/api/oidc/auth").query({ client_id: client.id, response_type: "code", redirect_uri: "https://client.example/callback", scope: "openid", code_challenge_method: "S256", code_challenge: challenge }).expect(303);
		const retryPath = new URL(retry.headers.location, issuer).pathname;
		const retryLogin = await agent.post(retryPath).send({ action: "login" }).expect(200);
		const retryResume = new URL(retryLogin.body.redirect);
		const retryConsent = await agent.get(`${retryResume.pathname}${retryResume.search}`).expect(303);
		expect((await agent.get(`${new URL(retryConsent.headers.location, issuer).pathname}/details`).expect(200)).body.prompt).toBe("consent");
		await clients.remove(client.id);
		await agent.get("/api/oidc/me").set("Authorization", `Bearer ${token.body.access_token}`).expect(401);
	}, 15_000);

	it("allows the user to deny a request without issuing an authorization code", async () => {
		const client = await clients.create({ name: "Denied app", type: "public", redirectUris: ["https://client.example/callback"] });
		const agent = request.agent(app.server);
		const verifier = randomBytes(32).toString("base64url");
		const challenge = createHash("sha256").update(verifier).digest("base64url");
		const authorization = await agent
			.get("/api/oidc/auth")
			.query({
				client_id: client.id,
				response_type: "code",
				redirect_uri: "https://client.example/callback",
				scope: "openid",
				state: "denial-state",
				code_challenge_method: "S256",
				code_challenge: challenge,
			})
			.expect(303);
		const interactionPath = new URL(authorization.headers.location, issuer).pathname;
		const denied = await agent.post(interactionPath).send({ action: "deny" }).expect(200);
		const resume = new URL(denied.body.redirect);
		const result = await agent.get(`${resume.pathname}${resume.search}`).expect(303);
		const callback = new URL(result.headers.location);
		expect(callback.searchParams.get("error")).toBe("access_denied");
		expect(callback.searchParams.get("state")).toBe("denial-state");
		expect(callback.searchParams.has("code")).toBe(false);
	});

	it("does not restore a grant when approval is revoked during restoration", async () => {
		const client = await clients.create({ name: "Concurrent app", type: "public", redirectUris: ["https://client.example/callback"] });
		await db.query(`INSERT INTO oidc_consents (account_id, client_id, scopes, claims) VALUES ($1, $2, ARRAY['openid'], ARRAY[]::text[])`, [userId, client.id]);
		const agent = request.agent(app.server);
		const challenge = createHash("sha256").update(randomBytes(32).toString("base64url")).digest("base64url");
		const start = await agent.get("/api/oidc/auth").query({
			client_id: client.id, response_type: "code", redirect_uri: "https://client.example/callback",
			scope: "openid", code_challenge_method: "S256", code_challenge: challenge,
		}).expect(303);
		const path = new URL(start.headers.location, issuer).pathname;
		const login = await agent.post(path).send({ action: "login" }).expect(200);
		const resume = new URL(login.body.redirect);
		const originalQuery = db.query.bind(db);
		let revoked = false;
		const querySpy = vi.spyOn(db, "query").mockImplementation(async (sql, params, runner) => {
			const result = await originalQuery(sql, params, runner);
			if (!revoked && sql.includes(`INSERT INTO "oidc_artifacts"`) && params?.[0] === "Grant") {
				revoked = true;
				await new OidcConsentService(db).revoke(userId, client.id);
			}
			return result;
		});
		try {
			const next = await agent.get(`${resume.pathname}${resume.search}`).expect(303);
			expect(revoked).toBe(true);
			const consentPath = new URL(next.headers.location, issuer).pathname;
			expect((await agent.get(`${consentPath}/details`).expect(200)).body.prompt).toBe("consent");
			expect(await originalQuery(`SELECT id FROM oidc_artifacts WHERE kind = 'Grant' AND payload->>'clientId' = $1`, [client.id])).toEqual([]);
		} finally {
			querySpy.mockRestore();
		}
	}, 15_000);

	it("remembers approval per account and client, but prompts for new permissions and explicit consent", async () => {
		const client = await clients.create({ name: "Remembered app", type: "public", redirectUris: ["https://client.example/callback"] });
		const otherClient = await clients.create({ name: "Other app", type: "public", redirectUris: ["https://client.example/callback"] });
		const challenge = createHash("sha256").update(randomBytes(32).toString("base64url")).digest("base64url");
		const start = async (agent: ReturnType<typeof request.agent>, clientId: string, scope: string, prompt?: string) => {
			const response = await agent
				.get("/api/oidc/auth")
				.query({
					client_id: clientId,
					response_type: "code",
					redirect_uri: "https://client.example/callback",
					scope,
					...(prompt ? { prompt } : {}),
					code_challenge_method: "S256",
					code_challenge: challenge,
				})
				.expect(303);
			const path = new URL(response.headers.location, issuer).pathname;
			expect((await agent.get(`${path}/details`).expect(200)).body.prompt).toBe("login");
			const login = await agent.post(path).send({ action: "login" }).expect(200);
			const resume = new URL(login.body.redirect);
			return agent.get(`${resume.pathname}${resume.search}`).expect(303);
		};
		const approve = async (agent: ReturnType<typeof request.agent>, response: { headers: Record<string, string> }) => {
			const path = new URL(response.headers.location, issuer).pathname;
			expect((await agent.get(`${path}/details`).expect(200)).body.prompt).toBe("consent");
			const decision = await agent.post(path).send({ action: "approve" }).expect(200);
			const resume = new URL(decision.body.redirect);
			const callback = await agent.get(`${resume.pathname}${resume.search}`).expect(303);
			expect(new URL(callback.headers.location).searchParams.has("code")).toBe(true);
		};
		try {
			const first = request.agent(app.server);
			await approve(first, await start(first, client.id, "openid profile"));
			expect(new URL((await start(first, client.id, "openid profile")).headers.location).searchParams.has("code")).toBe(true);
			await db.query(`UPDATE oidc_artifacts SET expires_at = now() - interval '1 second' WHERE kind = 'Grant' AND payload->>'clientId' = $1`, [client.id]);
			service = new OidcProviderService(db);
			const fresh = request.agent(app.server);
			const repeated = await start(fresh, client.id, "openid profile");
			expect(new URL(repeated.headers.location).searchParams.has("code")).toBe(true);
			const additional = await start(fresh, client.id, "openid profile email");
			const additionalPath = new URL(additional.headers.location, issuer).pathname;
			expect((await fresh.get(`${additionalPath}/details`).expect(200)).body.prompt).toBe("consent");
			const denied = await fresh.post(additionalPath).send({ action: "deny" }).expect(200);
			const deniedReturn = new URL(denied.body.redirect);
			await fresh.get(`${deniedReturn.pathname}${deniedReturn.search}`).expect(303);
			const unchanged = request.agent(app.server);
			expect(new URL((await start(unchanged, client.id, "openid profile")).headers.location).searchParams.has("code")).toBe(true);
			await approve(fresh, await start(fresh, client.id, "openid profile email"));
			const broader = request.agent(app.server);
			expect(new URL((await start(broader, client.id, "openid profile email")).headers.location).searchParams.has("code")).toBe(true);
			await approve(broader, await start(broader, client.id, "openid profile", "consent"));
			const differentApp = request.agent(app.server);
			await approve(differentApp, await start(differentApp, otherClient.id, "openid"));
			activeUserId = otherUserId;
			const differentUser = request.agent(app.server);
			const otherResponse = await start(differentUser, client.id, "openid profile");
			const path = new URL(otherResponse.headers.location, issuer).pathname;
			expect((await differentUser.get(`${path}/details`).expect(200)).body.prompt).toBe("consent");
			const denial = await differentUser.post(path).send({ action: "deny" }).expect(200);
			const deniedResume = new URL(denial.body.redirect);
			await differentUser.get(`${deniedResume.pathname}${deniedResume.search}`).expect(303);
			const retry = request.agent(app.server);
			const retryResponse = await start(retry, client.id, "openid profile");
			expect((await retry.get(`${new URL(retryResponse.headers.location, issuer).pathname}/details`).expect(200)).body.prompt).toBe("consent");
			await approve(retry, retryResponse);
			await db.getRepository(User).delete(otherUserId);
			expect(await db.query(`SELECT account_id FROM oidc_consents WHERE account_id = $1`, [otherUserId])).toEqual([]);
		} finally {
			activeUserId = userId;
		}
		await clients.remove(client.id);
		expect(await db.query(`SELECT client_id FROM oidc_consents WHERE client_id = $1`, [client.id])).toEqual([]);
	}, 15_000);

	it("requires the correct PKCE verifier and confidential client secret", async () => {
		const client = await clients.create({ name: "Server app", type: "confidential", redirectUris: ["https://client.example/callback"] });
		if (!client.secret) throw new Error("Missing confidential client secret");
		const agent = request.agent(app.server);
		const verifier = randomBytes(32).toString("base64url");
		const challenge = createHash("sha256").update(verifier).digest("base64url");
		const authorize = async (prompt = false) => {
			const start = await agent
				.get("/api/oidc/auth")
				.query({
					client_id: client.id,
					response_type: "code",
					redirect_uri: "https://client.example/callback",
					scope: "openid",
					...(prompt ? { prompt: "consent" } : {}),
					code_challenge_method: "S256",
					code_challenge: challenge,
				})
				.expect(303);
			let path = new URL(start.headers.location, issuer).pathname;
			expect((await agent.get(`${path}/details`).expect(200)).body.prompt).toBe("login");
			const login = await agent.post(path).send({ action: "login" }).expect(200);
			let resume = new URL(login.body.redirect);
			const next = await agent.get(`${resume.pathname}${resume.search}`).expect(303);
			path = new URL(next.headers.location, issuer).pathname;
			expect((await agent.get(`${path}/details`).expect(200)).body.prompt).toBe("consent");
			const consent = await agent.post(path).send({ action: "approve" }).expect(200);
			resume = new URL(consent.body.redirect);
			const result = await agent.get(`${resume.pathname}${resume.search}`).expect(303);
			const code = new URL(result.headers.location).searchParams.get("code");
			if (!code) throw new Error("Missing authorization code");
			return code;
		};
		const exchange = (code: string, codeVerifier: string) => ({
			grant_type: "authorization_code",
			redirect_uri: "https://client.example/callback",
			code,
			code_verifier: codeVerifier,
		});
		const firstCode = await authorize();
		await agent.post("/api/oidc/token").auth(client.id, "incorrect").type("form").send(exchange(firstCode, verifier)).expect(401);
		await agent
			.post("/api/oidc/token")
			.auth(client.id, client.secret)
			.type("form")
			.send(exchange(firstCode, randomBytes(32).toString("base64url")))
			.expect(400);
		const secondCode = await authorize(true);
		const token = await agent.post("/api/oidc/token").auth(client.id, client.secret).type("form").send(exchange(secondCode, verifier)).expect(200);
		expect(token.body.id_token).toBeTruthy();
		expect(token.body.refresh_token).toBeUndefined();
	});
});
