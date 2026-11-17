import { Controller, Inject } from "@tsed/di";
import { BadRequest, Forbidden, NotFound, Unauthorized } from "@tsed/exceptions";
import { Context, HeaderParams, PathParams, QueryParams } from "@tsed/platform-params";
import type { PlatformContext } from "@tsed/platform-http";
import { Get, Security } from "@tsed/schema";
import { DataSource } from "typeorm";
import { DefaultDataSource } from "../../datasources/defaultDataSource.datasource.js";
import { User } from "../../entities/user.entity.js";
import { MediaItem } from "../../entities/mediaItem.entity.js";
import { MediaAccessService, scheduleStatus } from "../access/mediaAccessService.js";
import { EntitlementService } from "../payments/entitlementService.js";
import { isUuid } from "../payments/paymentTypes.js";
import { OidcProviderService } from "./oidcProviderService.js";
import type { OidcResourceScope } from "./oidcResourceScopes.js";

/** Read-only resources available to explicitly authorized OAuth applications. */
@Controller("/oauth/me")
@Security("BearerAuth")
export class OidcResourceController {
	constructor(
		@Inject(DefaultDataSource) private readonly dataSource: DataSource,
		private readonly oidc: OidcProviderService,
		private readonly access: MediaAccessService,
		private readonly entitlements: EntitlementService,
	) {}

	private async authorize(header: string | undefined, scope: OidcResourceScope, ctx: PlatformContext): Promise<User> {
		ctx.response.setHeader("Cache-Control", "no-store");
		const match = /^Bearer ([^\s]+)$/i.exec(header ?? "");
		if (!match) throw new Unauthorized("An OAuth access token is required.");
		const provider = await this.oidc.getProvider();
		const token = await provider.AccessToken.find(match[1]);
		const resource = `${provider.issuer}/resource`;
		if (!token?.isValid || token.aud !== resource || token.isSenderConstrained() || !token.clientId || !token.accountId || !token.grantId) throw new Unauthorized("Invalid OAuth access token.");
		const grant = await provider.Grant.find(token.grantId);
		if (!grant?.isValid || grant.clientId !== token.clientId || grant.accountId !== token.accountId) throw new Unauthorized("OAuth authorization has expired or been revoked.");
		const clients: Array<{ resource_scopes: string[]; approved: boolean }> = await this.dataSource.query(
			`SELECT c.resource_scopes, EXISTS(SELECT 1 FROM oidc_consents consent WHERE consent.client_id = c.id AND consent.account_id = $2 AND $3 = ANY(consent.scopes)) AS approved FROM oidc_clients c WHERE c.id = $1`,
			[token.clientId, token.accountId, scope],
		);
		if (!clients.length) throw new Unauthorized("OAuth client no longer exists.");
		if (!token.scopes.has(scope) || !grant.getResourceScope(resource).split(" ").includes(scope) || !clients[0].resource_scopes.includes(scope) || !clients[0].approved) throw new Forbidden("The OAuth token does not have the required permission.");
		const user = await this.dataSource.getRepository(User).findOneBy({ id: token.accountId });
		if (!user || user.disabledAt) throw new Unauthorized("The account is unavailable.");
		return user;
	}

	private pagination(limit: string | undefined, offset: string | undefined) {
		const parse = (value: string | undefined, fallback: number, min: number, max: number) => {
			if (value === undefined) return fallback;
			if (!/^\d+$/.test(value)) throw new BadRequest("Invalid pagination.");
			const n = Number(value);
			if (!Number.isSafeInteger(n) || n < min || n > max) throw new BadRequest("Invalid pagination.");
			return n;
		};
		return { limit: parse(limit, 25, 1, 100), offset: parse(offset, 0, 0, 1_000_000) };
	}

	private async page(sql: string, user: User, limit: string | undefined, offset: string | undefined) {
		const page = this.pagination(limit, offset);
		const rows: unknown[] = await this.dataSource.query(sql, [user.id, page.limit + 1, page.offset]);
		return { items: rows.slice(0, page.limit), nextOffset: rows.length > page.limit ? page.offset + page.limit : null };
	}

	@Get("/subscriptions")
	async subscriptions(@HeaderParams("authorization") auth: string | undefined, @QueryParams("limit") limit: string | undefined, @QueryParams("offset") offset: string | undefined, @Context() ctx: PlatformContext) {
		const user = await this.authorize(auth, "subscriptions:read", ctx);
		return this.page(`SELECT s.id, s.status, s.plan_id AS "planId", p.name AS "planName", s.period_end AS "periodEnd", s.grace_until AS "graceUntil", s.cancel_at_period_end AS "cancelAtPeriodEnd", COALESCE(s.status <> 'expired' AND (s.period_end > now() OR (s.status = 'past_due' AND s.grace_until > now())), false) AS active FROM payment_subscriptions s LEFT JOIN payment_plans p ON p.id = s.plan_id WHERE s.user_id = $1 ORDER BY s.created_at DESC, s.id LIMIT $2 OFFSET $3`, user, limit, offset);
	}

	@Get("/entitlements")
	async grants(@HeaderParams("authorization") auth: string | undefined, @QueryParams("limit") limit: string | undefined, @QueryParams("offset") offset: string | undefined, @Context() ctx: PlatformContext) {
		const user = await this.authorize(auth, "entitlements:read", ctx);
		return this.page(`SELECT id, source, scope, "expiresAt", "claimUntil", "activatedAt" FROM (
			SELECT id::text AS id, source, scope, expires_at AS "expiresAt", claim_until AS "claimUntil", activated_at AS "activatedAt", created_at AS sort_at
			FROM payment_entitlements WHERE user_id = $1 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now()) AND (rental_hours IS NULL OR activated_at IS NOT NULL OR claim_until > now())
			UNION ALL
			SELECT s.id::text || ':' || scope.ordinality::text, 'subscription', scope.value, CASE WHEN s.status = 'past_due' AND s.period_end <= now() THEN s.grace_until ELSE s.period_end END, NULL, NULL, s.created_at
			FROM payment_subscriptions s JOIN payment_plans p ON p.id = s.plan_id CROSS JOIN LATERAL jsonb_array_elements(p.scopes) WITH ORDINALITY AS scope(value, ordinality)
			WHERE s.user_id = $1 AND s.status <> 'expired' AND (s.period_end > now() OR (s.status = 'past_due' AND s.grace_until > now()))
		) grants ORDER BY sort_at DESC, id LIMIT $2 OFFSET $3`, user, limit, offset);
	}

	@Get("/purchases")
	async purchases(@HeaderParams("authorization") auth: string | undefined, @QueryParams("limit") limit: string | undefined, @QueryParams("offset") offset: string | undefined, @Context() ctx: PlatformContext) {
		const user = await this.authorize(auth, "purchases:read", ctx);
		return this.page(`SELECT id, kind, product_id AS "productId", description, status, created_at AS "createdAt" FROM payment_orders WHERE user_id = $1 AND kind IN ('purchase', 'rental') ORDER BY created_at DESC, id LIMIT $2 OFFSET $3`, user, limit, offset);
	}

	@Get("/access/:itemId")
	async check(@PathParams("itemId") itemId: string, @HeaderParams("authorization") auth: string | undefined, @Context() ctx: PlatformContext) {
		const user = await this.authorize(auth, "access:check", ctx);
		if (!isUuid(itemId)) throw new BadRequest("Invalid media item.");
		itemId = itemId.toLowerCase();
		const context = await this.entitlements.contextFor(itemId);
		if (!context) throw new NotFound("Media item not found.");
		const policy = await this.access.forUser(user.id);
		const blocked = await this.access.blockReason(policy, itemId);
		const schedule = scheduleStatus(policy.enforced ? policy.schedule : null);
		if (blocked || !schedule.allowed) return { allowed: false };
		return { allowed: !(await this.entitlements.lockState(user, context)).locked };
	}

	@Get("/library")
	async library(@HeaderParams("authorization") auth: string | undefined, @QueryParams("limit") limit: string | undefined, @QueryParams("offset") offset: string | undefined, @Context() ctx: PlatformContext) {
		const user = await this.authorize(auth, "library:read", ctx);
		const page = this.pagination(limit, offset);
		const policy = await this.access.forUser(user.id);
		const condition = this.access.restrictionSql("item", policy, { content: true });
		const qb = this.dataSource.getRepository(MediaItem).createQueryBuilder("item")
			.select("item.id", "id").addSelect("item.title", "title").addSelect("item.type", "type").addSelect("item.year", "year").addSelect("item.parentId", "parentId").addSelect("item.libraryId", "libraryId")
			.where(condition.sql, condition.params).orderBy("item.id", "ASC").skip(page.offset).take(page.limit + 1);
		const rows = await qb.getRawMany();
		return { items: rows.slice(0, page.limit), nextOffset: rows.length > page.limit ? page.offset + page.limit : null };
	}

	@Get("/favorites")
	async favorites(@HeaderParams("authorization") auth: string | undefined, @QueryParams("limit") limit: string | undefined, @QueryParams("offset") offset: string | undefined, @Context() ctx: PlatformContext) {
		const user = await this.authorize(auth, "favorites:read", ctx);
		return this.visiblePage(`SELECT item_id AS "itemId", created_at AS "createdAt" FROM favorites WHERE user_id = $1 ORDER BY created_at DESC, item_id LIMIT $2 OFFSET $3`, user, limit, offset);
	}

	private async visiblePage(sql: string, user: User, limit: string | undefined, offset: string | undefined) {
		const result = await this.page(sql, user, limit, offset);
		const rows = result.items as Array<{ itemId: string }>;
		const visible = await this.access.visibleIds(await this.access.forUser(user.id), rows.map((row) => row.itemId));
		return { ...result, items: rows.filter((row) => visible.has(row.itemId)) };
	}

	@Get("/playlists")
	async playlists(@HeaderParams("authorization") auth: string | undefined, @QueryParams("limit") limit: string | undefined, @QueryParams("offset") offset: string | undefined, @Context() ctx: PlatformContext) {
		const user = await this.authorize(auth, "playlists:read", ctx);
		return this.page(`SELECT id, name, description, is_public AS "isPublic", updated_at AS "updatedAt" FROM playlists WHERE user_id = $1 ORDER BY id LIMIT $2 OFFSET $3`, user, limit, offset);
	}

	@Get("/playlists/:id/items")
	async playlistItems(@PathParams("id") id: string, @HeaderParams("authorization") auth: string | undefined, @QueryParams("limit") limit: string | undefined, @QueryParams("offset") offset: string | undefined, @Context() ctx: PlatformContext) {
		const user = await this.authorize(auth, "playlists:read", ctx);
		if (!isUuid(id)) throw new BadRequest("Invalid playlist.");
		const page = this.pagination(limit, offset);
		const rows: Array<{ itemId: string; position: number }> = await this.dataSource.query(`SELECT i.item_id AS "itemId", i.position FROM playlist_items i JOIN playlists p ON p.id = i.playlist_id WHERE p.user_id = $1 AND p.id = $2 ORDER BY i.position, i.item_id LIMIT $3 OFFSET $4`, [user.id, id, page.limit + 1, page.offset]);
		const visible = await this.access.visibleIds(await this.access.forUser(user.id), rows.slice(0, page.limit).map((row) => row.itemId));
		return { items: rows.slice(0, page.limit).filter((row) => visible.has(row.itemId)), nextOffset: rows.length > page.limit ? page.offset + page.limit : null };
	}

	@Get("/progress")
	async progress(@HeaderParams("authorization") auth: string | undefined, @QueryParams("limit") limit: string | undefined, @QueryParams("offset") offset: string | undefined, @Context() ctx: PlatformContext) {
		const user = await this.authorize(auth, "progress:read", ctx);
		return this.visiblePage(`SELECT item_id AS "itemId", position_seconds AS "positionSeconds", duration_seconds AS "durationSeconds", completed, updated_at AS "updatedAt" FROM watch_progress WHERE user_id = $1 ORDER BY updated_at DESC, item_id LIMIT $2 OFFSET $3`, user, limit, offset);
	}

	@Get("/history")
	async history(@HeaderParams("authorization") auth: string | undefined, @QueryParams("limit") limit: string | undefined, @QueryParams("offset") offset: string | undefined, @Context() ctx: PlatformContext) {
		const user = await this.authorize(auth, "history:read", ctx);
		return this.visiblePage(`SELECT item_id AS "itemId", played_at AS "playedAt", play_count AS "playCount" FROM listening_history WHERE user_id = $1 ORDER BY played_at DESC, item_id LIMIT $2 OFFSET $3`, user, limit, offset);
	}

	@Get("/preferences")
	async preferences(@HeaderParams("authorization") auth: string | undefined, @Context() ctx: PlatformContext) {
		const user = await this.authorize(auth, "preferences:read", ctx);
		const data = user.preferences?.data ?? {};
		return { language: typeof data.language === "string" ? data.language : null };
	}
}
