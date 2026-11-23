import { Controller, Inject } from "@tsed/di";
import { BadRequest, Forbidden, NotFound, Unauthorized } from "@tsed/exceptions";
import { Context, HeaderParams, PathParams, QueryParams } from "@tsed/platform-params";
import type { PlatformContext } from "@tsed/platform-http";
import { Get, Security } from "@tsed/schema";
import { DataSource, type ObjectLiteral, type SelectQueryBuilder } from "typeorm";
import { DefaultDataSource } from "../../datasources/defaultDataSource.datasource.js";
import { Favorite } from "../../entities/favorite.entity.js";
import { ListeningHistory } from "../../entities/listeningHistory.entity.js";
import { OidcClient } from "../../entities/oidc.entity.js";
import { User } from "../../entities/user.entity.js";
import { PaymentOrder } from "../../entities/paymentOrder.entity.js";
import { PaymentPlan } from "../../entities/paymentPlan.entity.js";
import { PaymentSubscription } from "../../entities/paymentSubscription.entity.js";
import { MediaItem } from "../../entities/mediaItem.entity.js";
import { Playlist } from "../../entities/playlist.entity.js";
import { PlaylistItem } from "../../entities/playlistItem.entity.js";
import { WatchProgress } from "../../entities/watchProgress.entity.js";
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
		const client = await this.dataSource
			.getRepository(OidcClient)
			.createQueryBuilder("client")
			.select("client.resourceScopes", "resource_scopes")
			// RAW SQL: correlated EXISTS with PostgreSQL array membership preserves consent authorization semantics.
			.addSelect('EXISTS (SELECT 1 FROM "oidc_consents" consent WHERE consent.client_id = client.id AND consent.account_id = :accountId AND :scope = ANY(consent.scopes))', "approved")
			.where("client.id = :clientId", { clientId: token.clientId })
			.setParameter("accountId", token.accountId)
			.setParameter("scope", scope)
			.getRawOne<{ resource_scopes: string[]; approved: boolean }>();
		if (!client) throw new Unauthorized("OAuth client no longer exists.");
		if (!token.scopes.has(scope) || !grant.getResourceScope(resource).split(" ").includes(scope) || !client.resource_scopes.includes(scope) || !client.approved) throw new Forbidden("The OAuth token does not have the required permission.");
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

	private async pageRaw(sql: string, user: User, limit: string | undefined, offset: string | undefined) {
		const page = this.pagination(limit, offset);
		// RAW SQL: caller-supplied SQL over mixed tables; shared paging helper
		const rows: unknown[] = await this.dataSource.query(sql, [user.id, page.limit + 1, page.offset]);
		return { items: rows.slice(0, page.limit), nextOffset: rows.length > page.limit ? page.offset + page.limit : null };
	}

	private async page<T extends ObjectLiteral>(query: SelectQueryBuilder<T>, limit: string | undefined, offset: string | undefined) {
		const page = this.pagination(limit, offset);
		const rows = await query
			.skip(page.offset)
			.take(page.limit + 1)
			.getRawMany();
		return { items: rows.slice(0, page.limit), nextOffset: rows.length > page.limit ? page.offset + page.limit : null };
	}

	@Get("/subscriptions")
	async subscriptions(@HeaderParams("authorization") auth: string | undefined, @QueryParams("limit") limit: string | undefined, @QueryParams("offset") offset: string | undefined, @Context() ctx: PlatformContext) {
		const user = await this.authorize(auth, "subscriptions:read", ctx);
		const query = this.dataSource
			.getRepository(PaymentSubscription)
			.createQueryBuilder("s")
			.leftJoin(PaymentPlan, "p", "p.id = s.planId")
			.select("s.id", "id")
			.addSelect("s.status", "status")
			.addSelect("s.planId", "planId")
			.addSelect("p.name", "planName")
			.addSelect("s.periodEnd", "periodEnd")
			.addSelect("s.graceUntil", "graceUntil")
			.addSelect("s.cancelAtPeriodEnd", "cancelAtPeriodEnd")
			// RAW SQL: database-clock subscription activity expression.
			.addSelect("COALESCE(s.status <> 'expired' AND (s.periodEnd > now() OR (s.status = 'past_due' AND s.graceUntil > now())), false)", "active")
			.where("s.userId = :userId", { userId: user.id })
			.orderBy("s.createdAt", "DESC")
			.addOrderBy("s.id", "ASC");
		return this.page(query, limit, offset);
	}

	@Get("/entitlements")
	async grants(@HeaderParams("authorization") auth: string | undefined, @QueryParams("limit") limit: string | undefined, @QueryParams("offset") offset: string | undefined, @Context() ctx: PlatformContext) {
		const user = await this.authorize(auth, "entitlements:read", ctx);
		// RAW SQL: SQL passed to shared paging helper
		return this.pageRaw(
			`SELECT id, source, scope, "expiresAt", "claimUntil", "activatedAt" FROM (
			SELECT id::text AS id, source, scope, expires_at AS "expiresAt", claim_until AS "claimUntil", activated_at AS "activatedAt", created_at AS sort_at
			FROM payment_entitlements WHERE user_id = $1 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now()) AND (rental_hours IS NULL OR activated_at IS NOT NULL OR claim_until > now())
			UNION ALL
			SELECT s.id::text || ':' || scope.ordinality::text, 'subscription', scope.value, CASE WHEN s.status = 'past_due' AND s.period_end <= now() THEN s.grace_until ELSE s.period_end END, NULL, NULL, s.created_at
			FROM payment_subscriptions s JOIN payment_plans p ON p.id = s.plan_id CROSS JOIN LATERAL jsonb_array_elements(p.scopes) WITH ORDINALITY AS scope(value, ordinality)
			WHERE s.user_id = $1 AND s.status <> 'expired' AND (s.period_end > now() OR (s.status = 'past_due' AND s.grace_until > now()))
		) grants ORDER BY sort_at DESC, id LIMIT $2 OFFSET $3`,
			user,
			limit,
			offset,
		);
	}

	@Get("/purchases")
	async purchases(@HeaderParams("authorization") auth: string | undefined, @QueryParams("limit") limit: string | undefined, @QueryParams("offset") offset: string | undefined, @Context() ctx: PlatformContext) {
		const user = await this.authorize(auth, "purchases:read", ctx);
		const query = this.dataSource.getRepository(PaymentOrder).createQueryBuilder("order").select("order.id", "id").addSelect("order.kind", "kind").addSelect("order.productId", "productId").addSelect("order.description", "description").addSelect("order.status", "status").addSelect("order.createdAt", "createdAt").where("order.userId = :userId", { userId: user.id }).andWhere("order.kind IN ('purchase', 'rental')").orderBy("order.createdAt", "DESC").addOrderBy("order.id", "ASC");
		return this.page(query, limit, offset);
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
		const qb = this.dataSource
			.getRepository(MediaItem)
			.createQueryBuilder("item")
			.select("item.id", "id")
			.addSelect("item.title", "title")
			.addSelect("item.type", "type")
			.addSelect("item.year", "year")
			.addSelect("item.parentId", "parentId")
			.addSelect("item.libraryId", "libraryId")
			.where(condition.sql, condition.params)
			.orderBy("item.id", "ASC")
			.skip(page.offset)
			.take(page.limit + 1);
		const rows = await qb.getRawMany();
		return { items: rows.slice(0, page.limit), nextOffset: rows.length > page.limit ? page.offset + page.limit : null };
	}

	@Get("/favorites")
	async favorites(@HeaderParams("authorization") auth: string | undefined, @QueryParams("limit") limit: string | undefined, @QueryParams("offset") offset: string | undefined, @Context() ctx: PlatformContext) {
		const user = await this.authorize(auth, "favorites:read", ctx);
		const query = this.dataSource.getRepository(Favorite).createQueryBuilder("favorite").select("favorite.itemId", "itemId").addSelect("favorite.createdAt", "createdAt").where("favorite.userId = :userId", { userId: user.id }).orderBy("favorite.createdAt", "DESC").addOrderBy("favorite.itemId", "ASC");
		return this.visiblePage(query, user, limit, offset);
	}

	private async visiblePage<T extends ObjectLiteral>(query: SelectQueryBuilder<T>, user: User, limit: string | undefined, offset: string | undefined) {
		const result = await this.page(query, limit, offset);
		const rows = result.items as Array<{ itemId: string }>;
		const visible = await this.access.visibleIds(
			await this.access.forUser(user.id),
			rows.map((row) => row.itemId),
		);
		return { ...result, items: rows.filter((row) => visible.has(row.itemId)) };
	}

	@Get("/playlists")
	async playlists(@HeaderParams("authorization") auth: string | undefined, @QueryParams("limit") limit: string | undefined, @QueryParams("offset") offset: string | undefined, @Context() ctx: PlatformContext) {
		const user = await this.authorize(auth, "playlists:read", ctx);
		const query = this.dataSource.getRepository(Playlist).createQueryBuilder("playlist").select("playlist.id", "id").addSelect("playlist.name", "name").addSelect("playlist.description", "description").addSelect("playlist.isPublic", "isPublic").addSelect("playlist.updatedAt", "updatedAt").where("playlist.userId = :userId", { userId: user.id }).orderBy("playlist.id", "ASC");
		return this.page(query, limit, offset);
	}

	@Get("/playlists/:id/items")
	async playlistItems(@PathParams("id") id: string, @HeaderParams("authorization") auth: string | undefined, @QueryParams("limit") limit: string | undefined, @QueryParams("offset") offset: string | undefined, @Context() ctx: PlatformContext) {
		const user = await this.authorize(auth, "playlists:read", ctx);
		if (!isUuid(id)) throw new BadRequest("Invalid playlist.");
		const page = this.pagination(limit, offset);
		const rows = await this.dataSource
			.getRepository(PlaylistItem)
			.createQueryBuilder("entry")
			.innerJoin(Playlist, "playlist", "playlist.id = entry.playlistId")
			.select("entry.itemId", "itemId")
			.addSelect("entry.position", "position")
			.where("playlist.userId = :userId AND playlist.id = :id", { userId: user.id, id })
			.orderBy("entry.position", "ASC")
			.addOrderBy("entry.itemId", "ASC")
			.skip(page.offset)
			.take(page.limit + 1)
			.getRawMany<{ itemId: string; position: number }>();
		const visible = await this.access.visibleIds(
			await this.access.forUser(user.id),
			rows.slice(0, page.limit).map((row) => row.itemId),
		);
		return { items: rows.slice(0, page.limit).filter((row) => visible.has(row.itemId)), nextOffset: rows.length > page.limit ? page.offset + page.limit : null };
	}

	@Get("/progress")
	async progress(@HeaderParams("authorization") auth: string | undefined, @QueryParams("limit") limit: string | undefined, @QueryParams("offset") offset: string | undefined, @Context() ctx: PlatformContext) {
		const user = await this.authorize(auth, "progress:read", ctx);
		const query = this.dataSource.getRepository(WatchProgress).createQueryBuilder("progress").select("progress.itemId", "itemId").addSelect("progress.positionSeconds", "positionSeconds").addSelect("progress.durationSeconds", "durationSeconds").addSelect("progress.completed", "completed").addSelect("progress.updatedAt", "updatedAt").where("progress.userId = :userId", { userId: user.id }).orderBy("progress.updatedAt", "DESC").addOrderBy("progress.itemId", "ASC");
		return this.visiblePage(query, user, limit, offset);
	}

	@Get("/history")
	async history(@HeaderParams("authorization") auth: string | undefined, @QueryParams("limit") limit: string | undefined, @QueryParams("offset") offset: string | undefined, @Context() ctx: PlatformContext) {
		const user = await this.authorize(auth, "history:read", ctx);
		const query = this.dataSource.getRepository(ListeningHistory).createQueryBuilder("history").select("history.itemId", "itemId").addSelect("history.playedAt", "playedAt").addSelect("history.playCount", "playCount").where("history.userId = :userId", { userId: user.id }).orderBy("history.playedAt", "DESC").addOrderBy("history.itemId", "ASC");
		return this.visiblePage(query, user, limit, offset);
	}

	@Get("/preferences")
	async preferences(@HeaderParams("authorization") auth: string | undefined, @Context() ctx: PlatformContext) {
		const user = await this.authorize(auth, "preferences:read", ctx);
		const data = user.preferences?.data ?? {};
		return { language: typeof data.language === "string" ? data.language : null };
	}
}
