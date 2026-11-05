import { describe, expect, it } from "vitest";
import { anyScopeCovers, computeTotals, couponDiscount, pickPrice, scopeCovers, subscriptionGrantsAccess, type ItemContext } from "./paymentTypes.js";

const episode: ItemContext = { ids: ["ep", "season", "series"], kind: "tv", artists: [] };
const track: ItemContext = { ids: ["track", "album"], kind: "music", artists: ["some artist"] };

describe("scopeCovers", () => {
	it("covers everything with the all scope", () => {
		expect(scopeCovers({ type: "all", ref: null }, episode)).toBe(true);
	});

	it("matches by content kind", () => {
		expect(scopeCovers({ type: "kind", ref: "tv" }, episode)).toBe(true);
		expect(scopeCovers({ type: "kind", ref: "movies" }, episode)).toBe(false);
	});

	it("covers descendants of an item", () => {
		expect(scopeCovers({ type: "item", ref: "series" }, episode)).toBe(true);
		expect(scopeCovers({ type: "item", ref: "other" }, episode)).toBe(false);
	});

	it("matches artists case-insensitively", () => {
		expect(scopeCovers({ type: "artist", ref: "Some Artist" }, track)).toBe(true);
		expect(anyScopeCovers([{ type: "artist", ref: "nobody" }], track)).toBe(false);
	});
});

describe("pricing", () => {
	it("picks the requested currency and falls back", () => {
		const prices = [
			{ currency: "usd", amountMinor: 500 },
			{ currency: "eur", amountMinor: 450 },
		];
		expect(pickPrice(prices, "eur", "usd")?.amountMinor).toBe(450);
		expect(pickPrice(prices, "gbp", "usd")?.amountMinor).toBe(500);
	});

	it("caps coupon discounts at the subtotal", () => {
		expect(couponDiscount(1000, "usd", { percentOff: 25, amountOff: null })).toBe(250);
		expect(couponDiscount(300, "usd", { percentOff: null, amountOff: [{ currency: "usd", amountMinor: 500 }] })).toBe(300);
		expect(couponDiscount(300, "usd", null)).toBe(0);
	});

	it("adds exclusive tax and extracts inclusive tax", () => {
		const rates = [{ name: "VAT", percent: 20 }];
		expect(computeTotals(1000, 0, { enabled: true, inclusive: false, rates })).toMatchObject({ taxMinor: 200, totalMinor: 1200 });
		expect(computeTotals(1200, 0, { enabled: true, inclusive: true, rates })).toMatchObject({ taxMinor: 200, totalMinor: 1200 });
		expect(computeTotals(1000, 0, { enabled: false, inclusive: false, rates })).toMatchObject({ taxMinor: 0, totalMinor: 1000 });
	});
});

describe("subscriptionGrantsAccess", () => {
	const now = new Date("2030-01-10T00:00:00Z");
	const day = 86_400_000;

	it("grants access inside the paid period", () => {
		expect(subscriptionGrantsAccess({ status: "active", periodEnd: new Date(now.getTime() + day), graceUntil: null }, now)).toBe(true);
	});

	it("honours the grace window only when past due", () => {
		const ended = new Date(now.getTime() - day);
		const grace = new Date(now.getTime() + 2 * day);
		expect(subscriptionGrantsAccess({ status: "past_due", periodEnd: ended, graceUntil: grace }, now)).toBe(true);
		expect(subscriptionGrantsAccess({ status: "canceled", periodEnd: ended, graceUntil: grace }, now)).toBe(false);
		expect(subscriptionGrantsAccess({ status: "past_due", periodEnd: ended, graceUntil: new Date(now.getTime() - 1) }, now)).toBe(false);
	});
});
