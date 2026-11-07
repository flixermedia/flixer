import { Inject, Injectable } from "@tsed/di";
import { PaymentRequired } from "@tsed/exceptions";
import { randomUUID } from "node:crypto";
import { In, IsNull, DataSource, type EntityManager } from "typeorm";
import { DefaultDataSource } from "../../datasources/defaultDataSource.datasource.js";
import { MediaItem } from "../../entities/mediaItem.entity.js";
import { PaymentEntitlement } from "../../entities/paymentEntitlement.entity.js";
import { PaymentPlan } from "../../entities/paymentPlan.entity.js";
import { PaymentProduct } from "../../entities/paymentProduct.entity.js";
import { PaymentSubscription } from "../../entities/paymentSubscription.entity.js";
import { PaymentOrder } from "../../entities/paymentOrder.entity.js";
import { PaymentConfigService } from "./paymentConfigService.js";
import { anyScopeCovers, kindForItemType, scopeCovers, subscriptionGrantsAccess, type ContentScope, type ItemContext } from "./paymentTypes.js";

const CACHE_MS = 5_000;
const MAX_DEPTH = 4;

export interface AccessSubject {
	id: string;
	role: string;
	createdAt: Date;
}

export interface LockState {
	locked: boolean;
	/** Set when access comes from a rental, so the UI can show when it ends. */
	rentalEndsAt?: string | null;
}

function artistsOf(item: MediaItem): string[] {
	const names: string[] = [];
	for (const key of ["albumArtist", "artist"]) {
		const value = item.metadata?.[key];
		for (const entry of Array.isArray(value) ? value : [value]) {
			if (typeof entry === "string" && entry.trim()) {
				names.push(entry.trim().toLowerCase());
			}
		}
	}
	return names;
}

const SPECIFICITY: Record<string, number> = { all: 0, kind: 1, artist: 2, item: 2 };

function isAtLeastAsSpecific(scope: ContentScope, other: ContentScope): boolean {
	if (scope.type === other.type) {
		return scope.ref === other.ref;
	}
	return (SPECIFICITY[scope.type] ?? 0) > (SPECIFICITY[other.type] ?? 0);
}

/** Decides whether content is behind a paywall for a user, and records first-play rentals when they start. */
@Injectable()
export class EntitlementService {
	private gatedCache: { at: number; scopes: ContentScope[]; exclusive: ContentScope[] } | null = null;

	constructor(
		@Inject(DefaultDataSource) private readonly dataSource: DataSource,
		private readonly config: PaymentConfigService,
	) {}

	invalidate(): void {
		this.gatedCache = null;
	}

	/** Every scope that someone could sell, so content outside all of them stays free. */
	async gatedScopes(): Promise<ContentScope[]> {
		return (await this.gatedState()).scopes;
	}

	private async gatedState(): Promise<{ scopes: ContentScope[]; exclusive: ContentScope[] }> {
		if (this.gatedCache && Date.now() - this.gatedCache.at < CACHE_MS) {
			return this.gatedCache;
		}
		const config = await this.config.get();
		const [products, plans] = await Promise.all([this.dataSource.getRepository(PaymentProduct).findBy({ active: true }), this.dataSource.getRepository(PaymentPlan).findBy({ active: true })]);
		const scopes = [...products.map((product) => product.scope), ...plans.flatMap((plan) => plan.scopes)];
		if (config.registration.enabled && config.registration.mode === "one_time") {
			if (config.registration.unlocks === "all") {
				scopes.push({ type: "all", ref: null });
			} else if (config.registration.unlocks === "scopes") {
				scopes.push(...config.registration.scopes);
			}
		}
		const exclusive = products.filter((product) => product.requiresPurchase).map((product) => product.scope);
		this.gatedCache = { at: Date.now(), scopes, exclusive };
		return this.gatedCache;
	}

	async contextsFor(ids: string[]): Promise<Map<string, ItemContext>> {
		const items = this.dataSource.getRepository(MediaItem);
		const known = new Map<string, MediaItem>();
		let pending = [...new Set(ids)];
		for (let depth = 0; depth < MAX_DEPTH && pending.length > 0; depth++) {
			const rows = await items.findBy({ id: In(pending) });
			for (const row of rows) {
				known.set(row.id, row);
			}
			pending = [...new Set(rows.map((row) => row.parentId).filter((id): id is string => !!id && !known.has(id)))];
		}
		const result = new Map<string, ItemContext>();
		for (const id of ids) {
			const item = known.get(id);
			if (!item) {
				continue;
			}
			const chain: MediaItem[] = [];
			for (let cursor: MediaItem | undefined = item; cursor && chain.length < MAX_DEPTH; cursor = cursor.parentId ? known.get(cursor.parentId) : undefined) {
				chain.push(cursor);
			}
			result.set(id, {
				ids: chain.map((entry) => entry.id),
				kind: kindForItemType(item.type),
				artists: [...new Set(chain.flatMap(artistsOf))],
			});
		}
		return result;
	}

	async contextFor(itemId: string): Promise<ItemContext | null> {
		return (await this.contextsFor([itemId])).get(itemId) ?? null;
	}

	guideContext(channelId: string): ItemContext {
		return { ids: [channelId], kind: "guide", artists: [] };
	}

	private async activeGrants(subject: AccessSubject, now: Date) {
		const [entitlements, subscriptions] = await Promise.all([this.dataSource.getRepository(PaymentEntitlement).findBy({ userId: subject.id, revokedAt: IsNull() }), this.dataSource.getRepository(PaymentSubscription).find({ where: { userId: subject.id } })]);
		const plans = subscriptions.length ? new Map((await this.dataSource.getRepository(PaymentPlan).findBy({ id: In(subscriptions.map((sub) => sub.planId)) })).map((plan) => [plan.id, plan])) : new Map<string, PaymentPlan>();
		const live = entitlements.filter((entry) => entry.expiresAt === null || entry.expiresAt > now);
		const subscribed = subscriptions.filter((sub) => subscriptionGrantsAccess(sub, now)).flatMap((sub) => plans.get(sub.planId)?.scopes ?? []);
		return { entitlements: live, subscribed };
	}

	/** Ad-free subscriptions apply server-wide; purchases and rentals only cover their purchased scope. */
	async isAdExempt(userId: string, context: ItemContext): Promise<boolean> {
		if (!(await this.config.isActive())) return false;
		const now = new Date();
		const [entitlements, subscriptions] = await Promise.all([
			this.dataSource.getRepository(PaymentEntitlement).findBy({ userId, revokedAt: IsNull() }),
			this.dataSource.getRepository(PaymentSubscription).findBy({ userId }),
		]);
		const active = subscriptions.filter((entry) => subscriptionGrantsAccess(entry, now));
		if (active.length) {
			const plans = await this.dataSource.getRepository(PaymentPlan).findBy({ id: In(active.map((entry) => entry.planId)) });
			if (plans.some((plan) => plan.adsExempt)) return true;
		}
		const orders = entitlements.filter((entry) =>
			(entry.source === "purchase" || entry.source === "rental") &&
			entry.orderId !== null && (entry.expiresAt === null || entry.expiresAt > now) &&
			(entry.rentalHours === null || entry.activatedAt !== null) && scopeCovers(entry.scope, context),
		).map((entry) => entry.orderId!);
		if (!orders.length) return false;
		const paid = await this.dataSource.getRepository(PaymentOrder).findBy({ id: In(orders), userId });
		const productIds = paid.filter((order) => order.status === "paid" || order.status === "partially_refunded")
			.map((order) => order.productId).filter((id): id is string => id !== null);
		if (!productIds.length) return false;
		return (await this.dataSource.getRepository(PaymentProduct).findBy({ id: In(productIds) })).some((product) => product.adsExempt);
	}

	private async isGrandfathered(subject: AccessSubject): Promise<boolean> {
		const config = await this.config.get();
		return config.grandfatherExisting && !!config.enabledAt && subject.createdAt < new Date(config.enabledAt);
	}

	/** A one-word summary of what an account can currently reach, for the administrator's user view. */
	async accountLevel(subject: AccessSubject): Promise<"off" | "admin" | "grandfathered" | "everything" | "partial" | "none"> {
		if (!(await this.config.isActive())) {
			return "off";
		}
		if (subject.role === "admin") {
			return "admin";
		}
		if (await this.isGrandfathered(subject)) {
			return "grandfathered";
		}
		const { entitlements, subscribed } = await this.activeGrants(subject, new Date());
		const scopes = [...subscribed, ...entitlements.filter((entry) => entry.rentalHours === null || entry.activatedAt !== null).map((entry) => entry.scope)];
		if (scopes.some((scope) => scope.type === "all")) {
			return "everything";
		}
		return scopes.length > 0 || entitlements.length > 0 ? "partial" : "none";
	}

	private async evaluate(subject: AccessSubject, context: ItemContext, activate: boolean): Promise<LockState> {
		if (!(await this.config.isActive()) || subject.role === "admin") {
			return { locked: false };
		}
		const { scopes: gated, exclusive } = await this.gatedState();
		if (!anyScopeCovers(gated, context)) {
			return { locked: false };
		}
		const exclusiveScopes = exclusive.filter((scope) => scopeCovers(scope, context));
		if (exclusiveScopes.length === 0 && (await this.isGrandfathered(subject))) {
			return { locked: false };
		}
		const now = new Date();
		const { entitlements, subscribed } = await this.activeGrants(subject, now);
		if (exclusiveScopes.length === 0 && anyScopeCovers(subscribed, context)) {
			return { locked: false };
		}
		// Content that must be bought on its own ignores blanket access: only a direct purchase, rental or admin grant of that content counts.
		const direct = (entry: PaymentEntitlement) => entry.source !== "registration" && exclusiveScopes.some((scope) => isAtLeastAsSpecific(entry.scope, scope));
		const covering = entitlements.filter((entry) => scopeCovers(entry.scope, context) && (exclusiveScopes.length === 0 || direct(entry)));
		const running = covering.find((entry) => entry.rentalHours === null || entry.activatedAt !== null);
		if (running) {
			return { locked: false, rentalEndsAt: running.expiresAt?.toISOString() ?? null };
		}
		const unstarted = covering.find((entry) => entry.activatedAt === null && entry.rentalHours !== null && entry.claimUntil !== null && entry.claimUntil > now);
		if (unstarted) {
			if (!activate) {
				return { locked: false, rentalEndsAt: null };
			}
			const endsAt = new Date(now.getTime() + (unstarted.rentalHours ?? 0) * 3_600_000);
			await this.dataSource.getRepository(PaymentEntitlement).update({ id: unstarted.id }, { activatedAt: now, expiresAt: endsAt });
			return { locked: false, rentalEndsAt: endsAt.toISOString() };
		}
		return { locked: true };
	}

	async lockState(subject: AccessSubject, context: ItemContext): Promise<LockState> {
		return this.evaluate(subject, context, false);
	}

	/** Throws 402 when the item is paywalled and the user has not unlocked it; starts a first-play rental otherwise. */
	async assertCanPlay(subject: AccessSubject, context: ItemContext): Promise<void> {
		if ((await this.evaluate(subject, context, true)).locked) {
			throw new PaymentRequired("This content needs to be purchased, rented or unlocked with a subscription.");
		}
	}

	async lockStates(subject: AccessSubject, ids: string[]): Promise<Record<string, LockState>> {
		const contexts = await this.contextsFor(ids);
		const states: Record<string, LockState> = {};
		for (const id of ids) {
			const context = contexts.get(id);
			states[id] = context ? await this.lockState(subject, context) : { locked: false };
		}
		return states;
	}

	async grant(userId: string, scope: ContentScope, source: PaymentEntitlement["source"], orderId: string | null, rental?: { hours: number; startOnPlay: boolean; claimDays: number }, manager: EntityManager = this.dataSource.manager): Promise<PaymentEntitlement> {
		const now = new Date();
		const repository = manager.getRepository(PaymentEntitlement);
		return repository.save(
			repository.create({
				id: randomUUID(),
				userId,
				source,
				orderId,
				scope,
				rentalHours: rental?.hours ?? null,
				activatedAt: rental && !rental.startOnPlay ? now : null,
				expiresAt: rental && !rental.startOnPlay ? new Date(now.getTime() + rental.hours * 3_600_000) : null,
				claimUntil: rental?.startOnPlay ? new Date(now.getTime() + rental.claimDays * 86_400_000) : null,
				revokedAt: null,
			}),
		);
	}
}
