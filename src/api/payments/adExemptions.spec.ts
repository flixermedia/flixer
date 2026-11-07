import { describe, expect, it, vi } from "vitest";
import { PaymentEntitlement } from "../../entities/paymentEntitlement.entity.js";
import { PaymentOrder } from "../../entities/paymentOrder.entity.js";
import { PaymentPlan } from "../../entities/paymentPlan.entity.js";
import { PaymentProduct } from "../../entities/paymentProduct.entity.js";
import { PaymentSubscription } from "../../entities/paymentSubscription.entity.js";
import { EntitlementService } from "./entitlementService.js";

const context = { ids: ["movie"], kind: "movies" as const, artists: [] };
const future = new Date(Date.now() + 60_000);
const past = new Date(Date.now() - 60_000);

function setup(rows: Record<string, object[]> = {}, active = true) {
	const source = {
		getRepository: vi.fn((entity: { name: string }) => ({
			findBy: vi.fn(async (query: Record<string, unknown>) => {
				if (entity === PaymentEntitlement) expect(query).toHaveProperty("revokedAt");
				return rows[entity.name] ?? [];
			}),
		})),
	};
	const config = { isActive: vi.fn().mockResolvedValue(active) };
	return { service: new EntitlementService(source as never, config as never), source };
}

describe("advertisement exemptions", () => {
	it("does not grant exemptions when payments are disabled", async () => {
		const { service, source } = setup({}, false);
		expect(await service.isAdExempt("user", context)).toBe(false);
		expect(source.getRepository).not.toHaveBeenCalled();
	});

	it("honors ad-free subscriptions only while their access window is valid", async () => {
		const subscription = { planId: "plan", status: "active", periodEnd: future, graceUntil: null as Date | null };
		const rows = { [PaymentSubscription.name]: [subscription], [PaymentPlan.name]: [{ adsExempt: true }] };
		expect(await setup(rows).service.isAdExempt("user", context)).toBe(true);
		subscription.periodEnd = past;
		expect(await setup(rows).service.isAdExempt("user", context)).toBe(false);
		subscription.status = "past_due";
		subscription.graceUntil = future;
		expect(await setup(rows).service.isAdExempt("user", context)).toBe(true);
		subscription.status = "expired";
		expect(await setup(rows).service.isAdExempt("user", context)).toBe(false);
	});

	it("requires an active covering purchase or activated rental and a paid ad-free product", async () => {
		const grant = { source: "purchase", orderId: "order", expiresAt: null as Date | null, rentalHours: null as number | null, activatedAt: null as Date | null, scope: { type: "item", ref: "movie" } };
		const order = { status: "paid", productId: "product" };
		const product = { adsExempt: true };
		const rows = { [PaymentEntitlement.name]: [grant], [PaymentOrder.name]: [order], [PaymentProduct.name]: [product] };
		const check = () => setup(rows).service.isAdExempt("user", context);
		expect(await check()).toBe(true);
		grant.scope.ref = "other";
		expect(await check()).toBe(false);
		grant.scope.ref = "movie";
		grant.source = "rental";
		grant.rentalHours = 24;
		expect(await check()).toBe(false);
		grant.activatedAt = past;
		grant.expiresAt = future;
		expect(await check()).toBe(true);
		grant.expiresAt = past;
		expect(await check()).toBe(false);
		grant.expiresAt = future;
		order.status = "refunded";
		expect(await check()).toBe(false);
		order.status = "partially_refunded";
		expect(await check()).toBe(true);
		product.adsExempt = false;
		expect(await check()).toBe(false);
	});
});
