import { Inject, Injectable, logger } from "@tsed/di";
import { BadRequest, NotFound, PaymentRequired, Unauthorized } from "@tsed/exceptions";
import { randomUUID } from "node:crypto";
import { DataSource, In, IsNull, type EntityManager } from "typeorm";
import { DefaultDataSource } from "../../datasources/defaultDataSource.datasource.js";
import { MediaItem } from "../../entities/mediaItem.entity.js";
import { PaymentCoupon } from "../../entities/paymentCoupon.entity.js";
import { PaymentCustomer } from "../../entities/paymentCustomer.entity.js";
import { PaymentEntitlement } from "../../entities/paymentEntitlement.entity.js";
import { PaymentEvent } from "../../entities/paymentEvent.entity.js";
import { PaymentMethod } from "../../entities/paymentMethod.entity.js";
import { PaymentOrder, type PaymentOrderKind } from "../../entities/paymentOrder.entity.js";
import { PaymentPlan } from "../../entities/paymentPlan.entity.js";
import { PaymentProduct } from "../../entities/paymentProduct.entity.js";
import { PaymentSignup } from "../../entities/paymentSignup.entity.js";
import { PaymentSubscription } from "../../entities/paymentSubscription.entity.js";
import { User } from "../../entities/user.entity.js";
import { MailService } from "../auth/mailService.js";
import { EntitlementService } from "./entitlementService.js";
import { PaymentConfigService } from "./paymentConfigService.js";
import { PaymentProviderError, type CardSetupInput, type PaymentProvider } from "./paymentProvider.js";
import { signPendingSignupToken, signSetupToken, verifyPendingSignupToken, verifySetupToken } from "./paymentSecrets.js";
import { verifySquareSignature, verifyStripeSignature } from "./webhookSignature.js";
import { addInterval, computeTotals, couponDiscount, formatMinor, isUuid, normalizeCurrency, pickPrice, scopeCovers, subscriptionGrantsAccess, type ContentScope, type Price, type Totals } from "./paymentTypes.js";

const RENEWAL_RETRY_MS = 24 * 3_600_000;
const RENEWAL_LOCK_MS = 15 * 60_000;
const NETWORK_RETRY_MS = 3_600_000;
const FIRST_PLAY_CLAIM_DAYS = 30;
const MAX_CARDS = 5;

export interface PayingUser {
	id: string;
	email: string | null;
	displayName: string | null;
	role: string;
	createdAt: Date;
}

export interface CheckoutRequest {
	productId?: string;
	planId?: string;
	registration?: boolean;
	couponCode?: string;
	currency?: string;
	paymentMethodId?: string;
}

export interface SignupPayment extends CardSetupInput {
	setupToken?: string;
	couponCode?: string;
	currency?: string;
}

export interface Quote {
	kind: PaymentOrderKind;
	description: string;
	currency: string;
	totals: Totals;
	couponCode: string | null;
	productId: string | null;
	planId: string | null;
	trialDays: number;
	recurring: { amountMinor: number; interval: string } | null;
}

/** The card needs extra authentication (3-D Secure) before the registration fee can be taken. */
export interface SignupAction {
	requiresAction: true;
	orderId: string;
	clientSecret: string;
}

export interface CheckoutResult {
	status: "paid" | "requires_action" | "failed";
	orderId: string;
	clientSecret?: string;
	error?: string;
}

function bodyOf(value: unknown): Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

@Injectable()
export class PaymentsService {
	constructor(
		@Inject(DefaultDataSource) private readonly dataSource: DataSource,
		private readonly config: PaymentConfigService,
		private readonly entitlements: EntitlementService,
		private readonly mail: MailService,
	) {}

	private get orders() {
		return this.dataSource.getRepository(PaymentOrder);
	}

	private get signups() {
		return this.dataSource.getRepository(PaymentSignup);
	}

	private get methods() {
		return this.dataSource.getRepository(PaymentMethod);
	}

	private get subscriptions() {
		return this.dataSource.getRepository(PaymentSubscription);
	}

	private async requireActive(): Promise<PaymentProvider> {
		if (!(await this.config.isActive())) {
			throw new BadRequest("Payments are not turned on.");
		}
		return this.config.provider();
	}

	// ---- Public status and signup ---------------------------------------------------------------------------

	async status() {
		if (!(await this.config.isActive())) {
			return { enabled: false };
		}
		const config = await this.config.get();
		const plan = config.registration.enabled && config.registration.mode === "subscription" && config.registration.planId ? await this.dataSource.getRepository(PaymentPlan).findOneBy({ id: config.registration.planId }) : null;
		return {
			enabled: true,
			provider: config.provider,
			client: await this.config.clientSettings(),
			currency: config.currency,
			currencies: config.currencies,
			tax: { enabled: config.tax.enabled, inclusive: config.tax.inclusive, rates: config.tax.rates },
			registration: {
				cardRequired: true,
				feeEnabled: config.registration.enabled,
				mode: config.registration.mode,
				prices: config.registration.prices,
				price: pickPrice(config.registration.prices, null, config.currency),
				unlocks: config.registration.unlocks,
				plan: plan ? this.publicPlan(plan, config.currency) : null,
			},
		};
	}

	private publicPlan(plan: PaymentPlan, fallback: string) {
		return {
			id: plan.id,
			name: plan.name,
			description: plan.description,
			interval: plan.interval,
			prices: plan.prices,
			price: pickPrice(plan.prices, null, fallback),
			scopes: plan.scopes,
			trialDays: plan.trialDays,
		};
	}

	/** Whether a new account must supply a card, and so whether it starts out waiting for payment. */
	async cardRequiredForSignup(): Promise<boolean> {
		return this.config.isActive();
	}

	/** Records that an account was created but still has to save a card (and pay the registration fee, if there is one). */
	async markSignupPending(userId: string): Promise<void> {
		await this.signups.upsert({ userId }, ["userId"]);
	}

	/** Pending only while payments are on, so turning them off never locks anyone out. */
	async isSignupPending(userId: string): Promise<boolean> {
		return (await this.signups.existsBy({ userId })) && (await this.config.isActive());
	}

	issueSignupToken(userId: string): string {
		return signPendingSignupToken(userId);
	}

	private async pendingUser(token: string): Promise<User> {
		const userId = verifyPendingSignupToken(token);
		const user = userId ? await this.dataSource.getRepository(User).findOneBy({ id: userId }) : null;
		if (!user || user.disabledAt || !(await this.isSignupPending(user.id))) {
			throw new Unauthorized("This payment link has expired. Sign in again to continue.");
		}
		return user;
	}

	/** Starts a card-setup session for an account that registered but has not paid. Every call starts a fresh session, so a retry is always possible. */
	async beginPendingSetup(token: string) {
		const user = await this.pendingUser(token);
		const provider = await this.requireActive();
		const customerId = await this.ensureCustomer(user, provider);
		const setup = await provider.beginCardSetup(customerId);
		return {
			provider: provider.id,
			setupToken: signSetupToken(provider.id, customerId),
			clientSecret: setup.clientSecret ?? null,
			client: await this.config.clientSettings(),
		};
	}

	/** Saves the card, charges the registration fee and releases the account. Throws a 402 with the reason when the card or charge is refused, leaving the account waiting for another attempt. */
	async completePendingSignup(token: string, payment: SignupPayment | undefined, orderId?: string): Promise<User | SignupAction> {
		const user = await this.pendingUser(token);
		if (orderId) {
			// The browser has finished the card's extra authentication; the order is re-read from the provider, never trusted from the client.
			const outcome = await this.confirmOrder(user.id, orderId);
			if (outcome.status === "requires_action" && outcome.clientSecret) {
				return { requiresAction: true, orderId, clientSecret: outcome.clientSecret };
			}
			if (outcome.status !== "paid") {
				throw new PaymentRequired(outcome.error ?? "The registration payment did not go through.");
			}
		} else {
			const action = await this.completeSignup(user, payment);
			if (action) {
				return action;
			}
		}
		await this.signups.delete({ userId: user.id });
		return user;
	}

	private async completeSignup(user: PayingUser, payment: SignupPayment | undefined): Promise<SignupAction | null> {
		const provider = await this.requireActive();
		const sessionCustomer = payment?.setupToken ? verifySetupToken(payment.setupToken, provider.id) : null;
		if (!payment || !sessionCustomer) {
			throw new PaymentRequired("Add a card to finish creating your account.");
		}
		const customerId = await this.ensureCustomer(user, provider);
		if (sessionCustomer !== customerId) {
			throw new PaymentRequired("The card form expired. Enter your card again.");
		}
		// An earlier attempt may have saved a card before its charge was refused; the new card replaces it.
		for (const previous of await this.methods.findBy({ userId: user.id })) {
			await provider.removeCard(customerId, previous.providerRef).catch(() => undefined);
		}
		await this.methods.delete({ userId: user.id });
		let method: PaymentMethod;
		try {
			const card = await provider.completeCardSetup(customerId, payment);
			method = await this.saveCard(user.id, provider.id, card);
		} catch (error) {
			throw new PaymentRequired(error instanceof PaymentProviderError ? error.message : "The card could not be saved.");
		}
		const config = await this.config.get();
		if (!config.registration.enabled || (await this.orders.existsBy({ userId: user.id, kind: "registration", status: "paid" }))) {
			return null;
		}
		const result = await this.checkout(
			user,
			{
				registration: true,
				couponCode: payment.couponCode,
				currency: payment.currency,
				paymentMethodId: method.id,
			},
			{ interactive: true },
		);
		if (result.status === "requires_action" && result.clientSecret) {
			return { requiresAction: true, orderId: result.orderId, clientSecret: result.clientSecret };
		}
		if (result.status !== "paid") {
			throw new PaymentRequired(result.error ?? "The registration payment did not go through.");
		}
		return null;
	}

	// ---- Cards -----------------------------------------------------------------------------------------------

	private async saveCard(userId: string, provider: string, card: { ref: string; brand: string; last4: string; expMonth: number; expYear: number }) {
		const hasDefault = (await this.methods.countBy({ userId, isDefault: true })) > 0;
		return this.methods.save(
			this.methods.create({
				id: randomUUID(),
				userId,
				provider,
				providerRef: card.ref,
				brand: card.brand,
				last4: card.last4,
				expMonth: card.expMonth,
				expYear: card.expYear,
				isDefault: !hasDefault,
			}),
		);
	}

	private async ensureCustomer(user: PayingUser, provider: PaymentProvider): Promise<string> {
		const customers = this.dataSource.getRepository(PaymentCustomer);
		const existing = await customers.findOneBy({ userId: user.id, provider: provider.id });
		if (existing) {
			return existing.customerId;
		}
		const customerId = await provider.createCustomer({ email: user.email, name: user.displayName, reference: user.id });
		await customers.save({ id: randomUUID(), userId: user.id, provider: provider.id, customerId });
		return customerId;
	}

	listMethods(userId: string) {
		return this.methods.find({ where: { userId }, order: { createdAt: "ASC" } });
	}

	async beginMethodSetup(user: PayingUser) {
		const provider = await this.requireActive();
		if ((await this.methods.countBy({ userId: user.id })) >= MAX_CARDS) {
			throw new BadRequest(`You can keep up to ${MAX_CARDS} cards on file.`);
		}
		const customerId = await this.ensureCustomer(user, provider);
		const setup = await provider.beginCardSetup(customerId);
		return { provider: provider.id, clientSecret: setup.clientSecret ?? null, client: await this.config.clientSettings() };
	}

	async addMethod(user: PayingUser, input: CardSetupInput) {
		const provider = await this.requireActive();
		const customerId = await this.ensureCustomer(user, provider);
		try {
			return await this.saveCard(user.id, provider.id, await provider.completeCardSetup(customerId, input));
		} catch (error) {
			throw new BadRequest(error instanceof PaymentProviderError ? error.message : "The card could not be saved.");
		}
	}

	async setDefaultMethod(userId: string, methodId: string) {
		const method = await this.methods.findOneBy({ id: methodId, userId });
		if (!method) {
			throw new NotFound("Card not found.");
		}
		await this.methods.update({ userId }, { isDefault: false });
		await this.methods.update({ id: method.id }, { isDefault: true });
	}

	async removeMethod(userId: string, methodId: string) {
		const method = await this.methods.findOneBy({ id: methodId, userId });
		if (!method) {
			throw new NotFound("Card not found.");
		}
		const all = await this.methods.findBy({ userId });
		const live = (await this.subscriptions.findBy({ userId })).some((sub) => !sub.cancelAtPeriodEnd && ["trialing", "active", "past_due"].includes(sub.status));
		if (live && all.length === 1) {
			throw new BadRequest("Add another card or cancel your subscription before removing your only card.");
		}
		if (await this.config.isActive()) {
			const customer = await this.dataSource.getRepository(PaymentCustomer).findOneBy({ userId, provider: method.provider });
			await (await this.config.provider()).removeCard(customer?.customerId ?? "", method.providerRef).catch((error) => {
				logger().warn(`Could not remove a card from the payment provider: ${error instanceof Error ? error.message : error}`);
			});
		}
		await this.methods.delete({ id: method.id });
		if (method.isDefault) {
			const next = all.find((entry) => entry.id !== method.id);
			if (next) {
				await this.methods.update({ id: next.id }, { isDefault: true });
			}
		}
	}

	// ---- Quotes and checkout -------------------------------------------------------------------------------

	private async findCoupon(code: string | undefined, userId: string, target: { productId?: string | null; planId?: string | null }) {
		if (!code?.trim()) {
			return null;
		}
		const coupon = await this.dataSource.getRepository(PaymentCoupon).findOneBy({ code: code.trim().toUpperCase() });
		const now = new Date();
		const applies = coupon && ((coupon.productIds.length === 0 && coupon.planIds.length === 0) || (target.productId && coupon.productIds.includes(target.productId)) || (target.planId && coupon.planIds.includes(target.planId)));
		if (!coupon || !coupon.active || !applies || (coupon.expiresAt && coupon.expiresAt < now) || (coupon.maxRedemptions !== null && coupon.redeemed >= coupon.maxRedemptions)) {
			throw new BadRequest("This coupon code is not valid.");
		}
		if ((await this.orders.countBy({ userId, couponCode: coupon.code, status: "paid" })) > 0) {
			throw new BadRequest("You have already used this coupon.");
		}
		return coupon;
	}

	private async trialDaysFor(userId: string, plan: PaymentPlan): Promise<number> {
		if (plan.trialDays <= 0) {
			return 0;
		}
		return (await this.subscriptions.countBy({ userId, planId: plan.id })) > 0 ? 0 : plan.trialDays;
	}

	async quote(user: PayingUser, request: CheckoutRequest): Promise<Quote> {
		const config = await this.config.get();
		let kind: PaymentOrderKind;
		let description: string;
		let prices: Price[];
		let productId: string | null = null;
		let planId: string | null = null;
		let trialDays = 0;
		let recurringInterval: string | null = null;

		const loadPlan = async (id: string) => {
			const plan = await this.dataSource.getRepository(PaymentPlan).findOneBy({ id, active: true });
			if (!plan) {
				throw new NotFound("This plan is not available.");
			}
			return plan;
		};

		if (request.registration) {
			if (!config.registration.enabled) {
				throw new BadRequest("There is no registration fee.");
			}
			kind = "registration";
			if (config.registration.mode === "subscription") {
				const plan = await loadPlan(config.registration.planId ?? "");
				planId = plan.id;
				prices = plan.prices;
				description = `Registration: ${plan.name}`;
				trialDays = await this.trialDaysFor(user.id, plan);
				recurringInterval = plan.interval;
			} else {
				prices = config.registration.prices;
				description = "Registration";
			}
		} else if (request.planId) {
			if (!isUuid(request.planId)) {
				throw new NotFound("This plan is not available.");
			}
			const plan = await loadPlan(request.planId);
			kind = "subscription";
			planId = plan.id;
			prices = plan.prices;
			description = `Subscription: ${plan.name}`;
			trialDays = await this.trialDaysFor(user.id, plan);
			recurringInterval = plan.interval;
		} else if (request.productId && isUuid(request.productId)) {
			const product = await this.dataSource.getRepository(PaymentProduct).findOneBy({ id: request.productId, active: true });
			if (!product) {
				throw new NotFound("This product is not available.");
			}
			kind = product.kind === "rent" ? "rental" : "purchase";
			productId = product.id;
			prices = product.prices;
			description = `${product.kind === "rent" ? "Rental" : "Purchase"}: ${product.name}`;
		} else {
			throw new BadRequest("Choose something to buy.");
		}

		const currency = request.currency ? normalizeCurrency(request.currency) : null;
		const price = pickPrice(prices, currency, config.currency);
		if (!price) {
			throw new BadRequest("No price is set for this item.");
		}
		if (planId && !request.registration) {
			const live = (await this.subscriptions.findBy({ userId: user.id, planId })).some((sub) => subscriptionGrantsAccess(sub, new Date()) && !sub.cancelAtPeriodEnd);
			if (live) {
				throw new BadRequest("You are already subscribed to this plan.");
			}
		}
		const coupon = await this.findCoupon(request.couponCode, user.id, { productId, planId });
		const chargeNow = trialDays > 0 ? 0 : price.amountMinor;
		const discount = couponDiscount(chargeNow, price.currency, coupon);
		return {
			kind,
			description,
			currency: price.currency,
			totals: computeTotals(chargeNow, discount, config.tax),
			couponCode: coupon?.code ?? null,
			productId,
			planId,
			trialDays,
			recurring: recurringInterval ? { amountMinor: price.amountMinor, interval: recurringInterval } : null,
		};
	}

	async checkout(user: PayingUser, request: CheckoutRequest, options: { interactive: boolean } = { interactive: true }): Promise<CheckoutResult> {
		const provider = await this.requireActive();
		const quote = await this.quote(user, request);
		const order = await this.orders.save(
			this.orders.create({
				id: randomUUID(),
				userId: user.id,
				kind: quote.kind,
				productId: quote.productId,
				planId: quote.planId,
				subscriptionId: null,
				description: quote.description,
				currency: quote.currency,
				subtotalMinor: quote.totals.subtotalMinor,
				discountMinor: quote.totals.discountMinor,
				taxMinor: quote.totals.taxMinor,
				totalMinor: quote.totals.totalMinor,
				couponCode: quote.couponCode,
				status: "pending",
				provider: provider.id,
				providerRef: null,
				refundedMinor: 0,
				failure: null,
			}),
		);
		if (quote.totals.totalMinor === 0) {
			await this.fulfil(order.id);
			return { status: "paid", orderId: order.id };
		}
		const method = request.paymentMethodId ? await this.methods.findOneBy({ id: request.paymentMethodId, userId: user.id }) : await this.methods.findOneBy({ userId: user.id, isDefault: true });
		if (!method) {
			return this.fail(order, "Add a card first.");
		}
		const customer = await this.dataSource.getRepository(PaymentCustomer).findOneBy({ userId: user.id, provider: method.provider });
		if (!customer) {
			return this.fail(order, "Add a card first.");
		}
		try {
			const result = await provider.charge({
				customerId: customer.customerId,
				cardRef: method.providerRef,
				amountMinor: order.totalMinor,
				currency: order.currency,
				description: order.description,
				idempotencyKey: order.id,
				interactive: options.interactive,
				orderId: order.id,
			});
			if (result.status === "succeeded") {
				await this.orders.update({ id: order.id }, { providerRef: result.ref });
				await this.fulfil(order.id);
				return { status: "paid", orderId: order.id };
			}
			if (result.status === "requires_action" && options.interactive) {
				await this.orders.update({ id: order.id }, { providerRef: result.ref, status: "requires_action" });
				return { status: "requires_action", orderId: order.id, clientSecret: result.clientSecret };
			}
			return this.fail(order, result.error ?? "Your card needs extra verification. Pay again with the card on screen.", result.ref);
		} catch (error) {
			return this.fail(order, error instanceof PaymentProviderError ? error.message : "The payment could not be processed.");
		}
	}

	private async fail(order: PaymentOrder, message: string, ref: string | null = null): Promise<CheckoutResult> {
		await this.orders.update({ id: order.id }, { status: "failed", failure: message, ...(ref ? { providerRef: ref } : {}) });
		return { status: "failed", orderId: order.id, error: message };
	}

	/** Called by the browser after the card element has completed 3-D Secure. */
	/** The processor-hosted receipt for a paid order, read from the provider so nothing extra is stored. */
	async receiptUrl(userId: string, orderId: string): Promise<{ url: string }> {
		const order = await this.orders.findOneBy({ id: orderId, userId });
		if (!order?.providerRef || !["paid", "refunded", "partially_refunded"].includes(order.status)) {
			throw new NotFound("There is no receipt for this order.");
		}
		const result = await (await this.requireActive()).retrieveCharge(order.providerRef);
		if (!result.receiptUrl) {
			throw new NotFound("Your payment provider hasn't issued a receipt for this order.");
		}
		return { url: result.receiptUrl };
	}

	async confirmOrder(userId: string, orderId: string): Promise<CheckoutResult> {
		const order = await this.orders.findOneBy({ id: orderId, userId });
		if (!order) {
			throw new NotFound("Order not found.");
		}
		if (order.status === "paid") {
			return { status: "paid", orderId };
		}
		if (order.status !== "requires_action" || !order.providerRef) {
			return { status: "failed", orderId, error: order.failure ?? "This payment cannot be confirmed." };
		}
		const result = await (await this.requireActive()).retrieveCharge(order.providerRef);
		if (result.status === "succeeded") {
			await this.fulfil(order.id);
			return { status: "paid", orderId };
		}
		if (result.status === "failed") {
			return this.fail(order, result.error ?? "The payment did not go through.");
		}
		return { status: "requires_action", orderId, clientSecret: result.clientSecret };
	}

	/** Gives the buyer what they paid for. The status change is the claim, so a webhook racing the browser grants once. */
	async fulfil(orderId: string): Promise<void> {
		const config = await this.config.get();
		const granted = await this.dataSource.transaction(async (manager) => {
			const claim = await manager.createQueryBuilder().update(PaymentOrder).set({ status: "paid", failure: null }).where("id = :orderId AND status IN ('pending', 'requires_action')", { orderId }).execute();
			if (!claim.affected) {
				return null;
			}
			const order = await manager.getRepository(PaymentOrder).findOneByOrFail({ id: orderId });
			await this.grantFor(manager, order, config);
			if (order.couponCode) {
				await manager.query(`UPDATE payment_coupons SET redeemed = redeemed + 1 WHERE code = $1`, [order.couponCode]);
			}
			return order;
		});
		if (granted) {
			this.sendReceipt(granted).catch(() => undefined);
		}
	}

	private async grantFor(manager: EntityManager, order: PaymentOrder, config: Awaited<ReturnType<PaymentConfigService["get"]>>) {
		if (order.kind === "purchase" || order.kind === "rental") {
			const product = await manager.getRepository(PaymentProduct).findOneBy({ id: order.productId ?? "" });
			if (!product) {
				return;
			}
			await this.entitlements.grant(order.userId, product.scope, order.kind === "rental" ? "rental" : "purchase", order.id, order.kind === "rental" && product.rentalHours ? { hours: product.rentalHours, startOnPlay: product.rentalStart === "first_play", claimDays: FIRST_PLAY_CLAIM_DAYS } : undefined, manager);
			return;
		}
		if (order.kind === "registration" && config.registration.mode === "one_time") {
			const scopes: ContentScope[] = config.registration.unlocks === "all" ? [{ type: "all", ref: null }] : config.registration.unlocks === "scopes" ? config.registration.scopes : [];
			for (const scope of scopes) {
				await this.entitlements.grant(order.userId, scope, "registration", order.id, undefined, manager);
			}
			return;
		}
		if (order.planId) {
			const plan = await manager.getRepository(PaymentPlan).findOneBy({ id: order.planId });
			if (!plan) {
				return;
			}
			const price = pickPrice(plan.prices, order.currency, config.currency);
			const trialDays = await this.trialDaysFor(order.userId, plan);
			const now = new Date();
			const sub = await manager.getRepository(PaymentSubscription).save(
				manager.getRepository(PaymentSubscription).create({
					id: randomUUID(),
					userId: order.userId,
					planId: plan.id,
					status: trialDays > 0 ? "trialing" : "active",
					currency: price?.currency ?? order.currency,
					amountMinor: price?.amountMinor ?? order.subtotalMinor,
					periodEnd: trialDays > 0 ? new Date(now.getTime() + trialDays * 86_400_000) : addInterval(now, plan.interval),
					cancelAtPeriodEnd: false,
					failedAttempts: 0,
					nextAttemptAt: null,
					graceUntil: null,
					canceledAt: null,
				}),
			);
			await manager.getRepository(PaymentOrder).update({ id: order.id }, { subscriptionId: sub.id });
		}
	}

	// ---- Subscriptions ------------------------------------------------------------------------------------

	async cancelSubscription(userId: string | null, id: string, immediately = false) {
		const sub = await this.subscriptions.findOneBy(userId ? { id, userId } : { id });
		if (!sub) {
			throw new NotFound("Subscription not found.");
		}
		if (["canceled", "expired"].includes(sub.status)) {
			return sub;
		}
		if (immediately) {
			sub.status = "canceled";
			sub.canceledAt = new Date();
			sub.periodEnd = new Date();
			sub.graceUntil = null;
		} else {
			sub.cancelAtPeriodEnd = true;
		}
		return this.subscriptions.save(sub);
	}

	async resumeSubscription(userId: string, id: string) {
		const sub = await this.subscriptions.findOneBy({ id, userId });
		if (!sub || sub.status === "canceled" || sub.status === "expired") {
			throw new NotFound("This subscription can no longer be resumed.");
		}
		sub.cancelAtPeriodEnd = false;
		return this.subscriptions.save(sub);
	}

	/** Charges every subscription whose period has ended; run hourly by the job scheduler. */
	async runRenewals(now = new Date()): Promise<{ renewed: number; failed: number; ended: number }> {
		const totals = { renewed: 0, failed: 0, ended: 0 };
		if (!(await this.config.isActive())) {
			return totals;
		}
		const due = await this.dataSource.query(
			`SELECT id FROM payment_subscriptions
			 WHERE status IN ('trialing','active','past_due') AND period_end <= $1 AND (next_attempt_at IS NULL OR next_attempt_at <= $1)
			 LIMIT 200`,
			[now],
		);
		for (const { id } of due as { id: string }[]) {
			const claim = await this.subscriptions
				.createQueryBuilder()
				.update()
				.set({ nextAttemptAt: new Date(now.getTime() + RENEWAL_LOCK_MS) })
				.where("id = :id AND (next_attempt_at IS NULL OR next_attempt_at <= :now)", { id, now })
				.execute();
			if (!claim.affected) {
				continue;
			}
			try {
				const outcome = await this.renew(id, now);
				totals[outcome] += 1;
			} catch (error) {
				logger().error(`Renewing subscription ${id} failed: ${error instanceof Error ? error.message : error}`);
			}
		}
		return totals;
	}

	private async renew(id: string, now: Date): Promise<"renewed" | "failed" | "ended"> {
		const sub = await this.subscriptions.findOneByOrFail({ id });
		const plan = await this.dataSource.getRepository(PaymentPlan).findOneBy({ id: sub.planId });
		if (sub.cancelAtPeriodEnd || !plan) {
			await this.subscriptions.update({ id }, { status: sub.cancelAtPeriodEnd ? "canceled" : "expired", canceledAt: now, nextAttemptAt: null });
			return "ended";
		}
		const config = await this.config.get();
		const provider = await this.config.provider();
		const totals = computeTotals(sub.amountMinor, 0, config.tax);
		const attempt = sub.failedAttempts;
		const order = await this.orders.save(
			this.orders.create({
				id: randomUUID(),
				userId: sub.userId,
				kind: "subscription",
				productId: null,
				planId: plan.id,
				subscriptionId: sub.id,
				description: `Renewal: ${plan.name}`,
				currency: sub.currency,
				subtotalMinor: totals.subtotalMinor,
				discountMinor: 0,
				taxMinor: totals.taxMinor,
				totalMinor: totals.totalMinor,
				couponCode: null,
				status: "pending",
				provider: provider.id,
				providerRef: null,
				refundedMinor: 0,
				failure: null,
			}),
		);

		let failure: string | null = null;
		if (totals.totalMinor === 0) {
			await this.orders.update({ id: order.id }, { status: "paid" });
		} else {
			const method = (await this.methods.findOneBy({ userId: sub.userId, isDefault: true })) ?? (await this.methods.findOneBy({ userId: sub.userId }));
			const customer = method ? await this.dataSource.getRepository(PaymentCustomer).findOneBy({ userId: sub.userId, provider: method.provider }) : null;
			if (!method || !customer) {
				failure = "No card on file.";
			} else {
				try {
					const result = await provider.charge({
						customerId: customer.customerId,
						cardRef: method.providerRef,
						amountMinor: totals.totalMinor,
						currency: sub.currency,
						description: order.description,
						idempotencyKey: `renew:${sub.id}:${sub.periodEnd.getTime()}:${attempt}`,
						interactive: false,
						orderId: order.id,
					});
					if (result.status === "succeeded") {
						await this.orders.update({ id: order.id }, { status: "paid", providerRef: result.ref });
					} else {
						failure = result.error ?? "The card was declined.";
						await this.orders.update({ id: order.id }, { providerRef: result.ref });
					}
				} catch (error) {
					if (error instanceof PaymentProviderError && error.retryable) {
						await this.orders.update({ id: order.id }, { status: "failed", failure: error.message });
						await this.subscriptions.update({ id }, { nextAttemptAt: new Date(now.getTime() + NETWORK_RETRY_MS) });
						return "failed";
					}
					failure = error instanceof PaymentProviderError ? error.message : "The payment could not be processed.";
				}
			}
		}

		if (!failure) {
			let periodEnd = addInterval(sub.periodEnd, plan.interval);
			if (periodEnd <= now) {
				periodEnd = addInterval(now, plan.interval);
			}
			await this.subscriptions.update({ id }, { status: "active", periodEnd, failedAttempts: 0, graceUntil: null, nextAttemptAt: null });
			this.sendReceipt(order).catch(() => undefined);
			return "renewed";
		}

		await this.orders.update({ id: order.id }, { status: "failed", failure });
		const graceUntil = sub.graceUntil ?? new Date(sub.periodEnd.getTime() + config.graceDays * 86_400_000);
		const expired = now >= graceUntil;
		await this.subscriptions.update(
			{ id },
			{
				status: expired ? "expired" : "past_due",
				failedAttempts: attempt + 1,
				graceUntil,
				nextAttemptAt: expired ? null : new Date(now.getTime() + RENEWAL_RETRY_MS),
			},
		);
		this.sendPaymentFailed(sub, plan, graceUntil, expired).catch(() => undefined);
		return "failed";
	}

	// ---- Read models ----------------------------------------------------------------------------------------

	async me(user: PayingUser) {
		const config = await this.config.get();
		const [methods, subscriptions, orders, entitlements] = await Promise.all([this.listMethods(user.id), this.subscriptions.find({ where: { userId: user.id }, order: { createdAt: "DESC" } }), this.orders.find({ where: { userId: user.id }, order: { createdAt: "DESC" }, take: 50 }), this.dataSource.getRepository(PaymentEntitlement).findBy({ userId: user.id, revokedAt: IsNull() })]);
		const plans = new Map((await this.dataSource.getRepository(PaymentPlan).findBy({ id: In(subscriptions.map((sub) => sub.planId)) })).map((plan) => [plan.id, plan]));
		const now = new Date();
		const live = entitlements.filter((entry) => entry.expiresAt === null || entry.expiresAt > now);
		const itemIds = live.filter((entry) => entry.scope.type === "item" && entry.scope.ref).map((entry) => entry.scope.ref as string);
		const titles = new Map(itemIds.length ? (await this.dataSource.getRepository(MediaItem).find({ where: { id: In(itemIds) }, select: { id: true, title: true } })).map((item) => [item.id, item.title]) : []);
		return {
			currency: config.currency,
			methods: methods.map(({ id, brand, last4, expMonth, expYear, isDefault }) => ({ id, brand, last4, expMonth, expYear, isDefault })),
			subscriptions: subscriptions.map((sub) => ({
				id: sub.id,
				planId: sub.planId,
				planName: plans.get(sub.planId)?.name ?? "Plan",
				interval: plans.get(sub.planId)?.interval ?? "month",
				status: sub.status,
				currency: sub.currency,
				amountMinor: sub.amountMinor,
				periodEnd: sub.periodEnd,
				cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
				graceUntil: sub.graceUntil,
				active: subscriptionGrantsAccess(sub, now),
			})),
			orders: orders.map((order) => ({
				id: order.id,
				kind: order.kind,
				description: order.description,
				currency: order.currency,
				totalMinor: order.totalMinor,
				taxMinor: order.taxMinor,
				discountMinor: order.discountMinor,
				refundedMinor: order.refundedMinor,
				status: order.status,
				createdAt: order.createdAt,
			})),
			entitlements: live.map((entry) => ({
				id: entry.id,
				source: entry.source,
				scope: { ...entry.scope, label: entry.scope.label ?? titles.get(entry.scope.ref ?? "") ?? entry.scope.ref },
				expiresAt: entry.expiresAt,
				rentalNotStarted: entry.rentalHours !== null && entry.activatedAt === null,
				rentalHours: entry.rentalHours,
				claimUntil: entry.claimUntil,
			})),
		};
	}

	/** The administrator's view of one account: its access level, signup state, cards, subscriptions, orders and unlocks. */
	async adminUserOverview(userId: string) {
		const user = isUuid(userId) ? await this.dataSource.getRepository(User).findOneBy({ id: userId }) : null;
		if (!user) {
			throw new NotFound("User not found.");
		}
		const [overview, level, signupPending] = await Promise.all([this.me(user), this.entitlements.accountLevel(user), this.signups.existsBy({ userId })]);
		return { ...overview, level, signupPending, role: user.role };
	}

	/** Lets an account in without taking the signup card and fee, for example when the administrator comped it. */
	async adminWaiveSignup(userId: string): Promise<void> {
		await this.signups.delete({ userId });
	}

	async adminRemoveMethod(userId: string, methodId: string) {
		return this.removeMethod(userId, methodId);
	}

	/** Everything that can unlock one item for this user, with prices already picked for the server currency. */
	async offersFor(user: PayingUser, itemId: string) {
		const config = await this.config.get();
		const context = (await this.entitlements.contextFor(itemId)) ?? null;
		if (!context) {
			throw new NotFound("Media item not found.");
		}
		const [products, plans] = await Promise.all([this.dataSource.getRepository(PaymentProduct).find({ where: { active: true }, order: { sortOrder: "ASC", name: "ASC" } }), this.dataSource.getRepository(PaymentPlan).find({ where: { active: true }, order: { sortOrder: "ASC", name: "ASC" } })]);
		const registrationScopes: ContentScope[] = config.registration.enabled && config.registration.mode === "one_time" ? (config.registration.unlocks === "all" ? [{ type: "all", ref: null }] : config.registration.unlocks === "scopes" ? config.registration.scopes : []) : [];
		const paidRegistration = (await this.orders.countBy({ userId: user.id, kind: "registration", status: "paid" })) > 0;
		// Content that must be bought on its own cannot be unlocked by plans or registration, so only offer the products that are marked that way.
		const exclusive = products.some((product) => product.requiresPurchase && scopeCovers(product.scope, context));
		return {
			currency: config.currency,
			products: products
				.filter((product) => scopeCovers(product.scope, context) && (!exclusive || product.requiresPurchase))
				.map((product) => ({
					id: product.id,
					name: product.name,
					description: product.description,
					kind: product.kind,
					rentalHours: product.rentalHours,
					rentalStart: product.rentalStart,
					scope: product.scope,
					prices: product.prices,
					price: pickPrice(product.prices, null, config.currency),
				})),
			plans: plans.filter((plan) => !exclusive && plan.scopes.some((scope) => scopeCovers(scope, context))).map((plan) => this.publicPlan(plan, config.currency)),
			registration: !exclusive && !paidRegistration && registrationScopes.some((scope) => scopeCovers(scope, context)) ? { prices: config.registration.prices, price: pickPrice(config.registration.prices, null, config.currency) } : null,
		};
	}

	async listPlans(user: PayingUser) {
		const config = await this.config.get();
		const plans = await this.dataSource.getRepository(PaymentPlan).find({ where: { active: true }, order: { sortOrder: "ASC", name: "ASC" } });
		const mine = await this.subscriptions.findBy({ userId: user.id });
		return plans.map((plan) => ({
			...this.publicPlan(plan, config.currency),
			trialDays: plan.trialDays,
			subscribed: mine.some((sub) => sub.planId === plan.id && subscriptionGrantsAccess(sub, new Date())),
		}));
	}

	// ---- Admin -------------------------------------------------------------------------------------------------

	private async withUsers<T extends { userId: string }>(rows: T[]) {
		const users = rows.length ? await this.dataSource.getRepository(User).find({ where: { id: In([...new Set(rows.map((row) => row.userId))]) }, select: { id: true, username: true, displayName: true, email: true } }) : [];
		const byId = new Map(users.map((entry) => [entry.id, entry]));
		return rows.map((row) => ({ ...row, user: byId.get(row.userId) ? { id: row.userId, username: byId.get(row.userId)!.username, displayName: byId.get(row.userId)!.displayName } : { id: row.userId, username: "deleted user", displayName: null } }));
	}

	async adminOrders(page: number, pageSize: number, status?: string, userId?: string) {
		const where: Record<string, unknown> = {};
		if (status) {
			where.status = status;
		}
		if (userId && isUuid(userId)) {
			where.userId = userId;
		}
		const [rows, total] = await this.orders.findAndCount({ where, order: { createdAt: "DESC" }, skip: page * pageSize, take: pageSize });
		return { total, items: await this.withUsers(rows) };
	}

	async adminSubscriptions(status?: string) {
		const rows = await this.subscriptions.find({ where: status ? { status: status as PaymentSubscription["status"] } : {}, order: { createdAt: "DESC" }, take: 200 });
		const plans = new Map((await this.dataSource.getRepository(PaymentPlan).find()).map((plan) => [plan.id, plan.name]));
		return (await this.withUsers(rows)).map((row) => ({ ...row, planName: plans.get(row.planId) ?? "Deleted plan" }));
	}

	async stats() {
		const revenue = await this.dataSource.query(
			`SELECT currency, COALESCE(SUM(total_minor - refunded_minor), 0)::int AS "amountMinor", COUNT(*)::int AS orders
			 FROM payment_orders WHERE status IN ('paid','partially_refunded') AND created_at > now() - interval '30 days' GROUP BY currency`,
		);
		const subs = await this.dataSource.query(`SELECT status, COUNT(*)::int AS count FROM payment_subscriptions GROUP BY status`);
		const failed = await this.dataSource.query(`SELECT COUNT(*)::int AS count FROM payment_orders WHERE status = 'failed' AND created_at > now() - interval '30 days'`);
		return { revenue30d: revenue, subscriptions: subs, failed30d: failed[0]?.count ?? 0 };
	}

	async refund(orderId: string, amountMinor?: number) {
		const order = await this.orders.findOneBy({ id: orderId });
		if (!order || !order.providerRef || !["paid", "partially_refunded"].includes(order.status)) {
			throw new BadRequest("This order cannot be refunded.");
		}
		const remaining = order.totalMinor - order.refundedMinor;
		const amount = amountMinor ?? remaining;
		if (!Number.isInteger(amount) || amount < 1 || amount > remaining) {
			throw new BadRequest("Enter an amount up to what is left to refund.");
		}
		const provider = await this.config.provider();
		try {
			await provider.refund({ ref: order.providerRef, amountMinor: amount, currency: order.currency, idempotencyKey: `${order.id}:${order.refundedMinor}:${amount}` });
		} catch (error) {
			throw new BadRequest(error instanceof Error ? error.message : "The refund failed.");
		}
		await this.applyRefund(order, order.refundedMinor + amount);
		return this.orders.findOneByOrFail({ id: orderId });
	}

	private async applyRefund(order: PaymentOrder, refundedMinor: number) {
		const full = refundedMinor >= order.totalMinor;
		await this.orders.update({ id: order.id }, { refundedMinor, status: full ? "refunded" : "partially_refunded" });
		if (full) {
			await this.dataSource.getRepository(PaymentEntitlement).update({ orderId: order.id, revokedAt: IsNull() }, { revokedAt: new Date() });
		}
	}

	async listGrants(userId: string) {
		return this.dataSource.getRepository(PaymentEntitlement).find({ where: { userId, revokedAt: IsNull() }, order: { createdAt: "DESC" } });
	}

	async adminGrant(userId: string, scope: ContentScope, hours: number | null) {
		if (!isUuid(userId) || !(await this.dataSource.getRepository(User).existsBy({ id: userId }))) {
			throw new NotFound("User not found.");
		}
		return this.entitlements.grant(userId, scope, "admin", null, hours ? { hours, startOnPlay: false, claimDays: 0 } : undefined);
	}

	async adminRevoke(id: string) {
		await this.dataSource.getRepository(PaymentEntitlement).update({ id }, { revokedAt: new Date() });
	}

	/** Removes a deleted account's cards and access. Order history stays for the admin's records. */
	async purgeUser(userId: string): Promise<void> {
		const methods = await this.methods.findBy({ userId });
		if (methods.length > 0 && (await this.config.isActive())) {
			const provider = await this.config.provider();
			for (const method of methods) {
				await provider.removeCard("", method.providerRef).catch(() => undefined);
			}
		}
		await this.methods.delete({ userId });
		await this.signups.delete({ userId });
		await this.dataSource.getRepository(PaymentCustomer).delete({ userId });
		await this.dataSource.getRepository(PaymentEntitlement).delete({ userId });
		await this.subscriptions.delete({ userId });
	}

	// ---- Webhooks -----------------------------------------------------------------------------------------------

	/**
	 * Deliveries must carry a valid provider signature over the exact raw body. The real state is still read back from
	 * the provider's API, so a stale or replayed delivery cannot move an order into a state the provider doesn't report.
	 */
	async handleWebhook(providerId: string, rawBody: string, signature: string | undefined): Promise<{ handled: boolean }> {
		const config = await this.config.get();
		if (!(await this.config.isActive()) || config.provider !== providerId) {
			return { handled: false };
		}
		const credentials = await this.config.webhookCredentials();
		const valid = providerId === "stripe" ? verifyStripeSignature(rawBody, signature, credentials.stripeSecret ?? "") : verifySquareSignature(rawBody, signature, credentials.squareKey ?? "", credentials.squareUrl);
		if (!valid) {
			throw new Unauthorized("Invalid webhook signature.");
		}
		let payload: unknown;
		try {
			payload = JSON.parse(rawBody);
		} catch {
			throw new BadRequest("The webhook body is not valid JSON.");
		}
		const body = bodyOf(payload);
		const object = bodyOf(bodyOf(body.data).object);
		const type = String(body.type ?? "");
		let ref: string | null = null;
		let eventId: string | null = null;
		if (providerId === "stripe") {
			eventId = typeof body.id === "string" ? body.id : null;
			if (type.startsWith("payment_intent.")) {
				ref = typeof object.id === "string" ? object.id : null;
			} else if (type.startsWith("charge.")) {
				ref = typeof object.payment_intent === "string" ? object.payment_intent : null;
			}
		} else {
			eventId = typeof body.event_id === "string" ? body.event_id : null;
			const payment = bodyOf(object.payment);
			const refund = bodyOf(object.refund);
			ref = typeof payment.id === "string" ? payment.id : typeof refund.payment_id === "string" ? refund.payment_id : null;
		}
		if (!ref || !eventId) {
			return { handled: false };
		}
		const events = this.dataSource.getRepository(PaymentEvent);
		if (await events.existsBy({ provider: providerId, eventId })) {
			return { handled: true };
		}
		const order = await this.orders.findOneBy({ provider: providerId, providerRef: ref });
		if (order) {
			await this.syncOrder(order);
		}
		await events.save({ id: randomUUID(), provider: providerId, eventId }).catch(() => undefined);
		return { handled: Boolean(order) };
	}

	private async syncOrder(order: PaymentOrder) {
		if (!order.providerRef) {
			return;
		}
		const state = await (await this.config.provider()).retrieveCharge(order.providerRef);
		if (["pending", "requires_action"].includes(order.status)) {
			if (state.status === "succeeded") {
				await this.fulfil(order.id);
			} else if (state.status === "failed") {
				await this.orders.update({ id: order.id, status: order.status }, { status: "failed", failure: state.error ?? null });
			}
		}
		if (state.refundedMinor && state.refundedMinor > order.refundedMinor) {
			await this.applyRefund(order, state.refundedMinor);
		}
	}

	// ---- Email -----------------------------------------------------------------------------------------------------

	private async emailFor(userId: string) {
		const user = await this.dataSource.getRepository(User).findOneBy({ id: userId });
		return user?.email ? user : null;
	}

	private async sendReceipt(order: Pick<PaymentOrder, "id" | "userId" | "description" | "currency" | "subtotalMinor" | "discountMinor" | "taxMinor" | "totalMinor">) {
		if (order.totalMinor === 0 || !(await this.mail.isConfigured())) {
			return;
		}
		const user = await this.emailFor(order.userId);
		if (!user?.email) {
			return;
		}
		const money = (amount: number) => formatMinor(amount, order.currency);
		const lines = [`${order.description}: ${money(order.subtotalMinor)}`, ...(order.discountMinor ? [`Discount: -${money(order.discountMinor)}`] : []), ...(order.taxMinor ? [`Tax: ${money(order.taxMinor)}`] : []), `Total paid: ${money(order.totalMinor)}`];
		const escape = (text: string) => text.replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char] ?? char);
		await this.mail.send({
			to: user.email,
			subject: `Your receipt: ${order.description}`,
			text: `Thanks for your payment.\n\n${lines.join("\n")}\n\nOrder ${order.id}`,
			html: `<p>Thanks for your payment.</p><p>${lines.map(escape).join("<br>")}</p><p style="color:#888">Order ${order.id}</p>`,
		});
	}

	private async sendPaymentFailed(sub: PaymentSubscription, plan: PaymentPlan, graceUntil: Date, expired: boolean) {
		if (!(await this.mail.isConfigured())) {
			return;
		}
		const user = await this.emailFor(sub.userId);
		if (!user?.email) {
			return;
		}
		const text = expired ? `We could not renew your ${plan.name} subscription and it has ended. You can subscribe again at any time.` : `We could not renew your ${plan.name} subscription. Update your card before ${graceUntil.toUTCString()} to keep your access.`;
		await this.mail.send({ to: user.email, subject: `Payment failed for ${plan.name}`, text, html: `<p>${text.replace(/[&<>]/g, "")}</p>` });
	}
}
