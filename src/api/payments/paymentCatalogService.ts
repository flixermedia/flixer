import { Inject, Injectable } from "@tsed/di";
import { BadRequest, NotFound } from "@tsed/exceptions";
import { randomUUID } from "node:crypto";
import { DataSource, ILike } from "typeorm";
import { DefaultDataSource } from "../../datasources/defaultDataSource.datasource.js";
import { MediaItem } from "../../entities/mediaItem.entity.js";
import { PaymentCoupon } from "../../entities/paymentCoupon.entity.js";
import { PaymentPlan } from "../../entities/paymentPlan.entity.js";
import { PaymentProduct } from "../../entities/paymentProduct.entity.js";
import { EntitlementService } from "./entitlementService.js";
import { PaymentConfigService, assertPriceCurrencies } from "./paymentConfigService.js";
import { isUuid, parsePrices, parseScope, parseScopes, type PlanInterval, type RentalStart } from "./paymentTypes.js";

type Body = Record<string, unknown>;

const MAX_RENTAL_HOURS = 24 * 365;
const SEARCHABLE_TYPES = ["movie", "series", "season", "episode", "album", "track", "video"];

function requireBody(value: unknown): Body {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new BadRequest("The request body is invalid.");
	}
	return value as Body;
}

function name(value: unknown): string {
	if (typeof value !== "string" || !value.trim() || value.length > 200) {
		throw new BadRequest("Enter a name of up to 200 characters.");
	}
	return value.trim();
}

function description(value: unknown): string | null {
	if (value === undefined || value === null || value === "") {
		return null;
	}
	if (typeof value !== "string" || value.length > 2000) {
		throw new BadRequest("The description is too long.");
	}
	return value.trim();
}

function sortOrder(value: unknown): number {
	return typeof value === "number" && Number.isInteger(value) ? Math.max(-1000, Math.min(1000, value)) : 0;
}

@Injectable()
export class PaymentCatalogService {
	constructor(
		@Inject(DefaultDataSource) private readonly dataSource: DataSource,
		private readonly entitlements: EntitlementService,
		private readonly config: PaymentConfigService,
	) {}

	private get products() {
		return this.dataSource.getRepository(PaymentProduct);
	}

	private get plans() {
		return this.dataSource.getRepository(PaymentPlan);
	}

	private get coupons() {
		return this.dataSource.getRepository(PaymentCoupon);
	}

	listProducts() {
		return this.products.find({ order: { sortOrder: "ASC", name: "ASC" } });
	}

	listPlans() {
		return this.plans.find({ order: { sortOrder: "ASC", name: "ASC" } });
	}

	listCoupons() {
		return this.coupons.find({ order: { createdAt: "DESC" } });
	}

	private async applyProduct(target: PaymentProduct, body: Body): Promise<PaymentProduct> {
		target.name = name(body.name);
		target.description = description(body.description);
		if (body.kind !== "buy" && body.kind !== "rent") {
			throw new BadRequest("Choose whether the product is bought or rented.");
		}
		target.kind = body.kind;
		target.scope = parseScope(body.scope);
		target.prices = parsePrices(body.prices, { allowEmpty: false });
		assertPriceCurrencies(target.prices, (await this.config.get()).currencies);
		if (body.kind === "rent") {
			const hours = body.rentalHours;
			if (typeof hours !== "number" || !Number.isInteger(hours) || hours < 1 || hours > MAX_RENTAL_HOURS) {
				throw new BadRequest("Set how many hours a rental lasts.");
			}
			target.rentalHours = hours;
			target.rentalStart = (body.rentalStart === "first_play" ? "first_play" : "purchase") satisfies RentalStart;
		} else {
			target.rentalHours = null;
			target.rentalStart = "purchase";
		}
		target.requiresPurchase = body.requiresPurchase === true;
		target.active = body.active !== false;
		target.sortOrder = sortOrder(body.sortOrder);
		return target;
	}

	async saveProduct(id: string | null, raw: unknown): Promise<PaymentProduct> {
		const body = requireBody(raw);
		const existing = id ? await this.products.findOneBy({ id }) : null;
		if (id && !existing) {
			throw new NotFound("Product not found.");
		}
		const saved = await this.products.save(await this.applyProduct(existing ?? this.products.create({ id: randomUUID() }), body));
		this.entitlements.invalidate();
		return saved;
	}

	async deleteProduct(id: string): Promise<void> {
		await this.products.delete({ id });
		this.entitlements.invalidate();
	}

	private async applyPlan(target: PaymentPlan, body: Body): Promise<PaymentPlan> {
		target.name = name(body.name);
		target.description = description(body.description);
		if (body.interval !== "month" && body.interval !== "year") {
			throw new BadRequest("Choose a monthly or yearly interval.");
		}
		target.interval = body.interval satisfies PlanInterval;
		target.prices = parsePrices(body.prices, { allowEmpty: false });
		assertPriceCurrencies(target.prices, (await this.config.get()).currencies);
		target.scopes = parseScopes(body.scopes, { allowEmpty: false });
		const trial = body.trialDays ?? 0;
		if (typeof trial !== "number" || !Number.isInteger(trial) || trial < 0 || trial > 365) {
			throw new BadRequest("A free trial can last up to 365 days.");
		}
		target.trialDays = trial;
		target.active = body.active !== false;
		target.sortOrder = sortOrder(body.sortOrder);
		return target;
	}

	async savePlan(id: string | null, raw: unknown): Promise<PaymentPlan> {
		const body = requireBody(raw);
		const existing = id ? await this.plans.findOneBy({ id }) : null;
		if (id && !existing) {
			throw new NotFound("Plan not found.");
		}
		const saved = await this.plans.save(await this.applyPlan(existing ?? this.plans.create({ id: randomUUID() }), body));
		this.entitlements.invalidate();
		return saved;
	}

	async deletePlan(id: string): Promise<void> {
		const subscribers = await this.dataSource.query(`SELECT 1 FROM payment_subscriptions WHERE plan_id = $1 AND status IN ('trialing','active','past_due') LIMIT 1`, [id]);
		if (subscribers.length > 0) {
			throw new BadRequest("This plan still has subscribers. Turn it off to stop new sign-ups instead of deleting it.");
		}
		await this.plans.delete({ id });
		this.entitlements.invalidate();
	}

	async saveCoupon(id: string | null, raw: unknown): Promise<PaymentCoupon> {
		const body = requireBody(raw);
		const existing = id ? await this.coupons.findOneBy({ id }) : null;
		if (id && !existing) {
			throw new NotFound("Coupon not found.");
		}
		const target = existing ?? this.coupons.create({ id: randomUUID(), redeemed: 0 });
		const code = typeof body.code === "string" ? body.code.trim().toUpperCase() : "";
		if (!/^[A-Z0-9_-]{3,64}$/.test(code)) {
			throw new BadRequest("A coupon code uses 3 to 64 letters, numbers, dashes or underscores.");
		}
		target.code = code;
		target.description = description(body.description);
		const percent = body.percentOff ?? null;
		if (percent !== null && (typeof percent !== "number" || !Number.isInteger(percent) || percent < 1 || percent > 100)) {
			throw new BadRequest("A percentage discount is between 1 and 100.");
		}
		target.percentOff = percent as number | null;
		target.amountOff = percent === null ? parsePrices(body.amountOff, { allowEmpty: false }) : null;
		if (target.amountOff) {
			assertPriceCurrencies(target.amountOff, (await this.config.get()).currencies);
		}
		const max = body.maxRedemptions ?? null;
		if (max !== null && (typeof max !== "number" || !Number.isInteger(max) || max < 1)) {
			throw new BadRequest("The redemption limit must be at least 1.");
		}
		target.maxRedemptions = max as number | null;
		if (body.expiresAt === null || body.expiresAt === undefined || body.expiresAt === "") {
			target.expiresAt = null;
		} else {
			const date = new Date(String(body.expiresAt));
			if (Number.isNaN(date.getTime())) {
				throw new BadRequest("The expiry date is invalid.");
			}
			target.expiresAt = date;
		}
		const ids = (value: unknown) => {
			if (value === undefined) {
				return [];
			}
			if (!Array.isArray(value) || !value.every(isUuid)) {
				throw new BadRequest("The coupon restrictions are invalid.");
			}
			return value.map((entry) => entry.toLowerCase());
		};
		target.productIds = ids(body.productIds);
		target.planIds = ids(body.planIds);
		target.active = body.active !== false;
		try {
			return await this.coupons.save(target);
		} catch (error) {
			if ((error as { code?: string }).code === "23505") {
				throw new BadRequest("A coupon with this code already exists.");
			}
			throw error;
		}
	}

	async deleteCoupon(id: string): Promise<void> {
		await this.coupons.delete({ id });
	}

	/** Finds media to attach a price to; artists come from the music tags. */
	async searchScopes(query: string, type?: string) {
		const text = query.trim();
		if (text.length < 2) {
			return { items: [], artists: [] };
		}
		const like = `%${text.replace(/[\\%_]/g, "\\$&")}%`;
		const types = type && SEARCHABLE_TYPES.includes(type) ? [type] : SEARCHABLE_TYPES;
		const rows = await this.dataSource.getRepository(MediaItem).find({
			where: types.map((entry) => ({ type: entry as MediaItem["type"], title: ILike(like), isPlaceholder: false })),
			order: { title: "ASC" },
			take: 25,
			select: { id: true, title: true, type: true, year: true, parentId: true, seasonNumber: true, episodeNumber: true },
		});
		const artists: { artist: string }[] = await this.dataSource.query(
			`SELECT DISTINCT COALESCE(metadata->>'albumArtist', metadata->>'artist') AS artist
			 FROM media_items
			 WHERE type IN ('album','track') AND COALESCE(metadata->>'albumArtist', metadata->>'artist') ILIKE $1
			 LIMIT 10`,
			[like],
		);
		return {
			items: rows.map((row) => ({
				id: row.id,
				title: row.title,
				type: row.type,
				year: row.year,
				seasonNumber: row.seasonNumber,
				episodeNumber: row.episodeNumber,
			})),
			artists: artists.map((row) => row.artist).filter(Boolean),
		};
	}
}
