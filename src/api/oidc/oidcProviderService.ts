import { Inject, Injectable } from "@tsed/di";
import { BadRequest, ServiceUnavailable } from "@tsed/exceptions";
import { generateKeyPairSync, hkdfSync } from "node:crypto";
import Provider, { errors, interactionPolicy, type JWKS } from "oidc-provider";
import { DataSource } from "typeorm";
import { appConfig } from "../../config/store/appConfig.js";
import { DefaultDataSource } from "../../datasources/defaultDataSource.datasource.js";
import { User } from "../../entities/user.entity.js";
import { PaymentSubscription } from "../../entities/paymentSubscription.entity.js";
import { subscriptionGrantsAccess } from "../payments/paymentTypes.js";
import { createOidcAdapter } from "./oidcAdapter.js";
import { decryptOidcSecret, encryptOidcSecret } from "./oidcSecrets.js";
import { isOidcResourceScope } from "./oidcResourceScopes.js";

/** Provides one configured OpenID Connect issuer for this server. */
@Injectable()
export class OidcProviderService {

	private provider?: { issuer: string; instance: Promise<Provider> };

	constructor(@Inject(DefaultDataSource) private readonly dataSource: DataSource) {}

	private validateOrigin(value: string): string {
		let url: URL;
		try {
			url = new URL(value);
		} catch {
			throw new BadRequest("Enter a valid public URL.");
		}
		const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
		if (value !== value.trim() || (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) || url.username || url.password || url.search || url.hash || (url.pathname !== "/" && url.pathname !== "")) {
			throw new BadRequest("The public URL must be an HTTPS origin (HTTP is allowed for localhost).");
		}
		return url.origin;
	}

	async getConfiguration(): Promise<{ publicUrl: string; issuer: string }> {
		const rows: Array<{ value: string }> = await this.dataSource.query(`SELECT "value" FROM "oidc_config" WHERE "key" = 'public_origin'`);
		const publicUrl = rows[0]?.value || "";
		return { publicUrl, issuer: publicUrl ? `${publicUrl}/api/oidc` : "" };
	}

	async setPublicUrl(value: string): Promise<{ publicUrl: string; issuer: string }> {
		const publicUrl = this.validateOrigin(value);
		await this.dataSource.query(`INSERT INTO "oidc_config" ("key", "value") VALUES ('public_origin', $1) ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value"`, [publicUrl]);
		return { publicUrl, issuer: `${publicUrl}/api/oidc` };
	}

	async getProvider(): Promise<Provider> {
		const { issuer } = await this.getConfiguration();
		if (!issuer) throw new ServiceUnavailable("Configure the OAuth public URL in the admin dashboard.");
		if (!this.provider || this.provider.issuer !== issuer) {
			const entry = { issuer, instance: this.createProvider(issuer) };
			this.provider = entry;
			entry.instance.catch(() => {
				if (this.provider === entry) this.provider = undefined;
			});
		}
		return this.provider.instance;
	}

	private async createProvider(issuer: string): Promise<Provider> {
		const secret = appConfig().require("jwtSecret");
		if (Buffer.byteLength(secret) < 32) throw new Error("The Flixer login secret must be at least 32 bytes to enable OpenID Connect.");
		const keys = await this.signingKeys();
		const cookieKey = Buffer.from(hkdfSync("sha256", Buffer.from(secret), Buffer.alloc(0), "flixer:oidc-cookie:v1", 32)).toString("base64url");
		const dataSource = this.dataSource;
		const policy = interactionPolicy.base();
		policy.get("login")?.checks.add(new interactionPolicy.Check("flixer_session", "Flixer session must be verified", (ctx) => (ctx.oidc.result?.login ? interactionPolicy.Check.NO_NEED_TO_PROMPT : interactionPolicy.Check.REQUEST_PROMPT)));
		const provider = new Provider(issuer, {
			adapter: (kind) => createOidcAdapter(dataSource, kind),
			jwks: keys,
			cookies: { keys: [cookieKey], short: { sameSite: "lax", httpOnly: true }, long: { sameSite: "lax", httpOnly: true } },
			features: {
				devInteractions: { enabled: false },
				revocation: { enabled: true },
				resourceIndicators: {
					enabled: true,
					async getResourceServerInfo(ctx, resource, client) {
						if (resource !== `${issuer}/resource`) throw new errors.InvalidTarget("Unknown resource.");
						const rows: Array<{ resource_scopes: string[] }> = await dataSource.query(`SELECT "resource_scopes" FROM "oidc_clients" WHERE "id" = $1`, [client.clientId]);
						if (!rows.length) throw new errors.InvalidTarget("Unknown client.");
						const requested = typeof ctx.oidc.params?.scope === "string" ? ctx.oidc.params.scope.split(" ").filter(isOidcResourceScope) : [];
						const forbidden = requested.filter((scope) => !rows[0].resource_scopes.includes(scope));
						if (forbidden.length) throw new errors.InvalidScope("Resource permission is not allowed for this application.", forbidden.join(" "));
						return { scope: rows[0].resource_scopes.join(" "), audience: resource, accessTokenFormat: "opaque", accessTokenTTL: 3600 };
					},
				},
			},
			renderError(ctx, out) {
				const code = out.error === "invalid_redirect_uri" ? "invalid_redirect_uri" : "authorization_error";
				ctx.set("Cache-Control", "no-store");
				ctx.set("Referrer-Policy", "no-referrer");
				ctx.redirect(`/oauth/error?error=${code}`);
			},
			pkce: { required: () => true },
			async loadExistingGrant(ctx) {
				const accountId = ctx.oidc.account?.accountId;
				const clientId = ctx.oidc.client?.clientId;
				if (!clientId) return undefined;
				if (!accountId) return undefined;
				const submittedId = ctx.oidc.result?.consent?.grantId;
				if (submittedId) return ctx.oidc.provider.Grant.find(submittedId);
				const rows: Array<{ scopes: string[]; claims: string[] }> = await dataSource.query(
					`SELECT "scopes", "claims" FROM "oidc_consents" WHERE "account_id" = $1 AND "client_id" = $2`,
					[accountId, clientId],
				);
				const consent = rows[0];
				if (!consent) return undefined;
				const grant = new ctx.oidc.provider.Grant({ accountId, clientId });
				grant.addOIDCScope(consent.scopes.filter((scope) => !isOidcResourceScope(scope)));
				grant.addResourceScope(`${issuer}/resource`, consent.scopes.filter(isOidcResourceScope));
				grant.addOIDCClaims(consent.claims);
				const grantId = await grant.save();
				return dataSource.transaction(async (manager) => {
					const current: Array<{ scopes: string[]; claims: string[] }> = await manager.query(
						`SELECT "scopes", "claims" FROM "oidc_consents" WHERE "account_id" = $1 AND "client_id" = $2 FOR UPDATE`,
						[accountId, clientId],
					);
					const same = (left: string[], right: string[]) => left.length === right.length && left.every((item) => right.includes(item));
					if (current[0] && same(consent.scopes, current[0].scopes) && same(consent.claims, current[0].claims)) return grant;
					await manager.query(`DELETE FROM "oidc_artifacts" WHERE kind = 'Grant' AND id = $1`, [grantId]);
					return undefined;
				});
			},
			ttl: { AuthorizationCode: 300, AccessToken: 3600, RefreshToken: 30 * 24 * 60 * 60, IdToken: 600, Interaction: 600, Session: 3600, Grant: 30 * 24 * 60 * 60 },
			rotateRefreshToken: true,
			claims: { openid: ["sub"], profile: ["name", "preferred_username"], email: ["email", "email_verified"], roles: ["roles"], groups: ["groups"], subscription: ["flixer_subscription_active"] },
			scopes: ["openid", "profile", "email", "offline_access", "roles", "groups", "subscription"],
			interactions: { policy, url: (_ctx, interaction) => `/api/oidc/interaction/${interaction.uid}` },
			async findAccount(ctx, id) {
				const user = await dataSource.getRepository(User).findOneBy({ id });
				if (!user || user.disabledAt) return undefined;
				return {
					accountId: user.id,
					async claims(_use, scope) {
						const scopes = new Set((scope ?? "").split(" "));
						let subscription: { flixer_subscription_active: boolean } | Record<string, never> = {};
						if (scopes.has("subscription") && ctx.oidc.client?.clientId) {
							const clients: Array<{ share_subscription: boolean }> = await dataSource.query(`SELECT "share_subscription" FROM "oidc_clients" WHERE "id" = $1`, [ctx.oidc.client.clientId]);
							if (clients[0]?.share_subscription) {
								const subscriptions = await dataSource.getRepository(PaymentSubscription).findBy({ userId: user.id });
								subscription = { flixer_subscription_active: subscriptions.some((item) => subscriptionGrantsAccess(item, new Date())) };
							}
						}
						return {
							sub: user.id,
							name: user.displayName || user.username,
							preferred_username: user.username,
							...(user.email ? { email: user.email, email_verified: !!user.emailVerifiedAt } : {}),
							...(scopes.has("roles") ? { roles: [user.role] } : {}),
							...(scopes.has("groups") ? { groups: [`flixer:${user.role}`] } : {}),
							...subscription,
						};
					},
				};
			},
		});
		provider.proxy = true;
		return provider;
	}

	private async signingKeys(): Promise<JWKS> {
		const existing: Array<{ value: string }> = await this.dataSource.query(`SELECT "value" FROM "oidc_config" WHERE "key" = 'signing_key'`);
		let encrypted = existing[0]?.value;
		if (!encrypted) {
			const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
			const key = { ...privateKey.export({ format: "jwk" }), kid: "flixer-1", use: "sig", alg: "RS256" };
			await this.dataSource.query(`INSERT INTO "oidc_config" ("key", "value") VALUES ('signing_key', $1) ON CONFLICT ("key") DO NOTHING`, [encryptOidcSecret(JSON.stringify(key))]);
			const rows: Array<{ value: string }> = await this.dataSource.query(`SELECT "value" FROM "oidc_config" WHERE "key" = 'signing_key'`);
			encrypted = rows[0]?.value;
		}
		if (!encrypted) throw new Error("Could not load the OpenID Connect signing key.");
		const key: JWKS["keys"][number] = JSON.parse(decryptOidcSecret(encrypted));
		return { keys: [key] };
	}
}
