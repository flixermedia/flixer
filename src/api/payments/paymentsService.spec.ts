import { describe, expect, it, vi } from "vitest";
import type { DataSource, EntityManager } from "typeorm";
import { PaymentEvent } from "../../entities/paymentEvent.entity.js";
import { PaymentOrder } from "../../entities/paymentOrder.entity.js";
import { PaymentPlan } from "../../entities/paymentPlan.entity.js";
import { PaymentProduct } from "../../entities/paymentProduct.entity.js";
import { PaymentsService } from "./paymentsService.js";

vi.mock("./webhookSignature.js", () => ({
	verifySquareSignature: vi.fn(() => true),
	verifyStripeSignature: vi.fn(() => true),
}));

function fulfilService(order: Partial<PaymentOrder>, product: unknown = null, plan: unknown = null) {
	let committedStatus: PaymentOrder["status"] = "pending";
	let stagedStatus: PaymentOrder["status"] | undefined;
	const repositories = new Map<unknown, Record<string, ReturnType<typeof vi.fn>>>([
		[PaymentOrder, { findOneByOrFail: vi.fn(async () => ({ ...order, status: stagedStatus ?? committedStatus })), update: vi.fn() }],
		[PaymentProduct, { findOneBy: vi.fn(async () => product) }],
		[PaymentPlan, { findOneBy: vi.fn(async () => plan) }],
	]);
	const manager = {
		createQueryBuilder: vi.fn(() => {
			const query = {
				update: vi.fn(() => query),
				set: vi.fn((value: Partial<PaymentOrder>) => {
					stagedStatus = value.status;
					return query;
				}),
				where: vi.fn(() => query),
				execute: vi.fn(async () => ({ affected: committedStatus === "pending" ? 1 : 0 })),
			};
			return query;
		}),
		getRepository: vi.fn((entity: unknown) => repositories.get(entity)),
		query: vi.fn(),
	};
	const dataSource = {
		transaction: vi.fn(async (operation: (manager: EntityManager) => Promise<unknown>) => {
			const result = await operation(manager as unknown as EntityManager);
			committedStatus = stagedStatus ?? committedStatus;
			return result;
		}),
	} as unknown as DataSource;
	const config = {
		get: vi.fn().mockResolvedValue({
			currency: "USD",
			registration: { mode: "one_time", unlocks: "none", scopes: [] },
		}),
	};
	const entitlements = { grant: vi.fn() };
	const service = new PaymentsService(dataSource, config as never, entitlements as never, {} as never, { touch: vi.fn() } as never);

	return { service, entitlements, getCommittedStatus: () => committedStatus };
}

describe("PaymentsService fulfilment", () => {
	it("keeps a purchase order recoverable when its product was deleted", async () => {
		const { service, entitlements, getCommittedStatus } = fulfilService({
			id: "order-1",
			userId: "user-1",
			kind: "purchase",
			productId: "product-1",
			planId: null,
		});

		await expect(service.fulfil("order-1")).rejects.toThrow(/product no longer exists/i);
		expect(getCommittedStatus()).toBe("pending");
		expect(entitlements.grant).not.toHaveBeenCalled();
	});

	it("keeps a subscription order recoverable when its plan was deleted", async () => {
		const { service, entitlements, getCommittedStatus } = fulfilService({
			id: "order-2",
			userId: "user-1",
			kind: "subscription",
			productId: null,
			planId: "plan-1",
		});

		await expect(service.fulfil("order-2")).rejects.toThrow(/subscription plan no longer exists/i);
		expect(getCommittedStatus()).toBe("pending");
		expect(entitlements.grant).not.toHaveBeenCalled();
	});
});

describe("PaymentsService webhook event persistence", () => {
	function webhookService(query: ReturnType<typeof vi.fn>) {
		const events = { existsBy: vi.fn().mockResolvedValue(false) };
		const orders = { findOneBy: vi.fn().mockResolvedValue(null) };
		const dataSource = {
			getRepository: vi.fn((entity: unknown) => (entity === PaymentEvent ? events : orders)),
			query,
		} as unknown as DataSource;
		const config = {
			get: vi.fn().mockResolvedValue({ provider: "stripe" }),
			isActive: vi.fn().mockResolvedValue(true),
			webhookCredentials: vi.fn().mockResolvedValue({ stripeSecret: "secret" }),
		};
		const service = new PaymentsService(dataSource, config as never, {} as never, {} as never, {} as never);
		return { service, dataSource };
	}

	const body = JSON.stringify({
		id: "evt-1",
		type: "payment_intent.succeeded",
		data: { object: { id: "pi-1" } },
	});

	it("records webhook IDs with a unique-key conflict guard", async () => {
		const query = vi.fn().mockResolvedValue(undefined);
		const { service, dataSource } = webhookService(query);

		await expect(service.handleWebhook("stripe", body, "signature")).resolves.toEqual({ handled: false });
		expect(query).toHaveBeenCalledWith(expect.stringContaining('ON CONFLICT ("provider", "event_id") DO NOTHING'), [expect.any(String), "stripe", "evt-1"]);
		expect(dataSource.getRepository).toHaveBeenCalledWith(PaymentEvent);
	});

	it("propagates failures to persist the webhook ID so the provider can retry", async () => {
		const query = vi.fn().mockRejectedValue(new Error("database unavailable"));
		const { service } = webhookService(query);

		await expect(service.handleWebhook("stripe", body, "signature")).rejects.toThrow("database unavailable");
	});
});
