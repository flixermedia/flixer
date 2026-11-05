import { BadRequest } from "@tsed/exceptions";

export const PAYMENT_PROVIDERS = ["stripe", "square"] as const;
export type PaymentProviderId = (typeof PAYMENT_PROVIDERS)[number];

export const CONTENT_KINDS = ["movies", "tv", "music", "guide"] as const;
export type ContentKind = (typeof CONTENT_KINDS)[number];

export const SCOPE_TYPES = ["all", "kind", "item", "artist"] as const;
export type ScopeType = (typeof SCOPE_TYPES)[number];

/** What a product, plan or registration unlocks. `item` covers the item and everything below it in the tree. */
export interface ContentScope {
	type: ScopeType;
	ref: string | null;
	label?: string;
}

export interface Price {
	currency: string;
	amountMinor: number;
}

export type RentalStart = "purchase" | "first_play";
export type PlanInterval = "month" | "year";
export type RegistrationMode = "one_time" | "subscription";
export type RegistrationUnlocks = "all" | "scopes" | "none";

export interface TaxRate {
	name: string;
	percent: number;
}

export interface PaymentConfig {
	enabled: boolean;
	provider: PaymentProviderId | null;
	currency: string;
	/** Currencies prices may be set in; always includes `currency`. */
	currencies: string[];
	graceDays: number;
	enabledAt: string | null;
	/** Accounts created before payments were first enabled keep full access unless this is off. */
	grandfatherExisting: boolean;
	registration: {
		enabled: boolean;
		mode: RegistrationMode;
		prices: Price[];
		planId: string | null;
		unlocks: RegistrationUnlocks;
		scopes: ContentScope[];
	};
	tax: { enabled: boolean; inclusive: boolean; rates: TaxRate[] };
	stripe: { publishableKey: string };
	square: { environment: "sandbox" | "production"; applicationId: string; locationId: string; webhookUrl: string };
}

export interface PaymentSecrets {
	stripeSecretKey?: string;
	squareAccessToken?: string;
	stripeWebhookSecret?: string;
	squareSignatureKey?: string;
}

export const DEFAULT_PAYMENT_CONFIG: PaymentConfig = {
	enabled: false,
	provider: null,
	currency: "USD",
	currencies: ["USD"],
	graceDays: 3,
	enabledAt: null,
	grandfatherExisting: true,
	registration: { enabled: false, mode: "one_time", prices: [], planId: null, unlocks: "all", scopes: [] },
	tax: { enabled: false, inclusive: false, rates: [] },
	stripe: { publishableKey: "" },
	square: { environment: "sandbox", applicationId: "", locationId: "", webhookUrl: "" },
};

/** An item's place in the content tree, used to decide which scopes cover it. */
export interface ItemContext {
	ids: string[];
	kind: ContentKind;
	/** Lower-cased artist names. */
	artists: string[];
}

const ITEM_TYPE_KIND: Record<string, ContentKind> = {
	movie: "movies",
	video: "movies",
	series: "tv",
	season: "tv",
	episode: "tv",
	album: "music",
	track: "music",
};

export function kindForItemType(type: string): ContentKind {
	return ITEM_TYPE_KIND[type] ?? "movies";
}

export function scopeCovers(scope: ContentScope, context: ItemContext): boolean {
	switch (scope.type) {
		case "all":
			return true;
		case "kind":
			return scope.ref === context.kind;
		case "item":
			return scope.ref !== null && context.ids.includes(scope.ref);
		case "artist":
			return scope.ref !== null && context.artists.includes(scope.ref.trim().toLowerCase());
		default:
			return false;
	}
}

export function anyScopeCovers(scopes: ContentScope[], context: ItemContext): boolean {
	return scopes.some((scope) => scopeCovers(scope, context));
}

const CURRENCY_PATTERN = /^[A-Z]{3}$/;
const MAX_MINOR = 100_000_000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
	return typeof value === "string" && UUID_PATTERN.test(value);
}

export function normalizeCurrency(value: unknown): string {
	const code = typeof value === "string" ? value.trim().toUpperCase() : "";
	if (!CURRENCY_PATTERN.test(code)) {
		throw new BadRequest("Currency must be a three-letter ISO code such as USD.");
	}
	return code;
}

export function parsePrices(value: unknown, { allowEmpty }: { allowEmpty: boolean }): Price[] {
	if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) {
		throw new BadRequest("Add at least one price.");
	}
	const seen = new Set<string>();
	return value.map((entry) => {
		const raw = (entry ?? {}) as Record<string, unknown>;
		const currency = normalizeCurrency(raw.currency);
		const amount = raw.amountMinor;
		if (typeof amount !== "number" || !Number.isInteger(amount) || amount < 0 || amount > MAX_MINOR) {
			throw new BadRequest("A price must be a whole number of minor units (for example cents).");
		}
		if (seen.has(currency)) {
			throw new BadRequest(`More than one price is set for ${currency}.`);
		}
		seen.add(currency);
		return { currency, amountMinor: amount };
	});
}

export function parseScope(value: unknown): ContentScope {
	const raw = (value ?? {}) as Record<string, unknown>;
	const type = raw.type;
	if (typeof type !== "string" || !(SCOPE_TYPES as readonly string[]).includes(type)) {
		throw new BadRequest("Unknown content scope.");
	}
	const label = typeof raw.label === "string" ? raw.label.slice(0, 200) : undefined;
	if (type === "all") {
		return { type: "all", ref: null };
	}
	if (type === "kind") {
		if (typeof raw.ref !== "string" || !(CONTENT_KINDS as readonly string[]).includes(raw.ref)) {
			throw new BadRequest("Choose Movies, TV shows, Music or Guide.");
		}
		return { type: "kind", ref: raw.ref, label };
	}
	if (type === "item") {
		if (!isUuid(raw.ref)) {
			throw new BadRequest("Choose a media item.");
		}
		return { type: "item", ref: raw.ref.toLowerCase(), label };
	}
	if (typeof raw.ref !== "string" || raw.ref.trim().length === 0 || raw.ref.length > 200) {
		throw new BadRequest("Enter an artist name.");
	}
	return { type: "artist", ref: raw.ref.trim(), label };
}

export function parseScopes(value: unknown, { allowEmpty }: { allowEmpty: boolean }): ContentScope[] {
	if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) {
		throw new BadRequest("Choose what this unlocks.");
	}
	return value.map(parseScope);
}

/** The price to charge in the requested currency, else the server currency, else the first price listed. */
export function pickPrice(prices: Price[], currency: string | null, fallback: string): Price | null {
	return (currency ? prices.find((price) => price.currency === currency) : undefined) ?? prices.find((price) => price.currency === fallback) ?? prices[0] ?? null;
}

export interface Totals {
	subtotalMinor: number;
	discountMinor: number;
	taxMinor: number;
	totalMinor: number;
}

export interface DiscountCoupon {
	percentOff: number | null;
	amountOff: Price[] | null;
}

export function couponDiscount(subtotalMinor: number, currency: string, coupon: DiscountCoupon | null): number {
	if (!coupon) {
		return 0;
	}
	if (coupon.percentOff) {
		return Math.min(subtotalMinor, Math.round((subtotalMinor * coupon.percentOff) / 100));
	}
	const fixed = coupon.amountOff?.find((price) => price.currency === currency);
	return fixed ? Math.min(subtotalMinor, fixed.amountMinor) : 0;
}

export function computeTotals(subtotalMinor: number, discountMinor: number, tax: PaymentConfig["tax"]): Totals {
	const taxable = Math.max(0, subtotalMinor - discountMinor);
	const percent = tax.enabled ? tax.rates.reduce((sum, rate) => sum + rate.percent, 0) : 0;
	if (percent <= 0) {
		return { subtotalMinor, discountMinor, taxMinor: 0, totalMinor: taxable };
	}
	if (tax.inclusive) {
		return { subtotalMinor, discountMinor, taxMinor: Math.round(taxable - taxable / (1 + percent / 100)), totalMinor: taxable };
	}
	const taxMinor = Math.round((taxable * percent) / 100);
	return { subtotalMinor, discountMinor, taxMinor, totalMinor: taxable + taxMinor };
}

export type SubscriptionStatus = "trialing" | "active" | "past_due" | "canceled" | "expired";

export interface AccessWindowSubscription {
	status: SubscriptionStatus;
	periodEnd: Date;
	graceUntil: Date | null;
}

/** A paid period always grants access; once it ends, only a past-due subscription still inside its grace window does. */
export function subscriptionGrantsAccess(sub: AccessWindowSubscription, now: Date): boolean {
	if (sub.status === "expired") {
		return false;
	}
	if (sub.periodEnd.getTime() > now.getTime()) {
		return true;
	}
	return sub.status === "past_due" && sub.graceUntil !== null && sub.graceUntil.getTime() > now.getTime();
}

export function addInterval(from: Date, interval: PlanInterval): Date {
	const next = new Date(from);
	if (interval === "year") {
		next.setUTCFullYear(next.getUTCFullYear() + 1);
	} else {
		next.setUTCMonth(next.getUTCMonth() + 1);
	}
	return next;
}

export function formatMinor(amountMinor: number, currency: string): string {
	try {
		const format = new Intl.NumberFormat("en", { style: "currency", currency });
		return format.format(amountMinor / 10 ** (format.resolvedOptions().maximumFractionDigits ?? 2));
	} catch {
		return `${(amountMinor / 100).toFixed(2)} ${currency}`;
	}
}
