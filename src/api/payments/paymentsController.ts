import { Controller } from "@tsed/di";
import { BadRequest, NotFound, TooManyRequests } from "@tsed/exceptions";
import type { PlatformContext } from "@tsed/platform-http";
import { BodyParams, Context, HeaderParams, PathParams, QueryParams, RawBodyParams } from "@tsed/platform-params";
import { Delete, Get, Patch, Post, Put, Security } from "@tsed/schema";
import { AuthService } from "../auth/authService.js";
import { AdminMediaService } from "../media/adminMediaService.js";
import { currenciesFor } from "./currencies.js";
import { EntitlementService } from "./entitlementService.js";
import { PaymentCatalogService } from "./paymentCatalogService.js";
import { PaymentConfigService } from "./paymentConfigService.js";
import { PaymentsService, type CheckoutRequest } from "./paymentsService.js";
import { CompleteSignupRequest, SignupPaymentTokenRequest } from "./signupPaymentRequest.js";
import { verifyReceiptArt } from "./paymentSecrets.js";
import { isUuid, parseScope } from "./paymentTypes.js";

type Body = Record<string, unknown>;

const SETUP_WINDOW_MS = 60 * 60_000;
const SETUP_LIMIT = 20;
const MAX_LOCK_CHECK = 200;
const setupAttempts = new Map<string, { count: number; resetAt: number }>();
const completeAttempts = new Map<string, { count: number; resetAt: number }>();

function throttle(ctx: PlatformContext, attempts: Map<string, { count: number; resetAt: number }>): void {
	const forwarded = ctx.request.get("x-forwarded-for");
	const key = (typeof forwarded === "string" ? forwarded.split(",")[0].trim() : "") || ctx.request.raw?.ip || "unknown";
	const now = Date.now();
	const entry = attempts.get(key);
	if (!entry || entry.resetAt < now) {
		attempts.set(key, { count: 1, resetAt: now + SETUP_WINDOW_MS });
		return;
	}
	if (++entry.count > SETUP_LIMIT) {
		throw new TooManyRequests("Too many attempts. Try again later.");
	}
}

function id(value: string, what: string): string {
	if (!AuthService.isUuid(value)) {
		throw new NotFound(`${what} not found.`);
	}
	return value.toLowerCase();
}

function object(value: unknown): Body {
	return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Body) : {};
}

function text(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

function checkoutRequest(body: Body): CheckoutRequest {
	return {
		productId: text(body.productId),
		planId: text(body.planId),
		registration: body.registration === true,
		couponCode: text(body.couponCode),
		currency: text(body.currency),
		paymentMethodId: text(body.paymentMethodId),
	};
}

/** Public payment status, cards on file, checkout and the signed-in user's billing. */
@Controller("/payments")
export class PaymentsController {
	constructor(
		private readonly auth: AuthService,
		private readonly payments: PaymentsService,
		private readonly entitlements: EntitlementService,
		private readonly config: PaymentConfigService,
		private readonly media: AdminMediaService,
	) {}

	/** The poster shown in receipt emails. Public because mail clients can't log in; the signature ties it to one item. */
	@Get("/receipt-art/:itemId")
	async receiptArt(@PathParams("itemId") itemId: string, @QueryParams("sig") sig: string | undefined, @QueryParams("i", Number) index: number | undefined, @Context() ctx: PlatformContext) {
		const itemRef = id(itemId, "Image");
		if (!sig || !verifyReceiptArt(itemRef, sig) || !Number.isInteger(index) || (index ?? 0) < 0) {
			throw new NotFound("Image not found.");
		}
		const { data, mime } = await this.media.image(itemRef, index ?? 0, 480);
		ctx.response.setHeader("Content-Type", mime);
		ctx.response.setHeader("Cache-Control", "public, max-age=86400");
		ctx.response.setHeader("X-Content-Type-Options", "nosniff");
		ctx.response.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
		return data;
	}

	@Get("/status")
	status() {
		return this.payments.status();
	}

	/** Starts a card-setup session for an account that registered but has not paid yet. */
	@Post("/signup/setup")
	signupSetup(@BodyParams() request: SignupPaymentTokenRequest, @Context() ctx: PlatformContext) {
		throttle(ctx, setupAttempts);
		return this.payments.beginPendingSetup(request.token);
	}

	/** Saves the card, takes the registration fee and signs the account in. Can be retried until it succeeds. */
	@Post("/signup/complete")
	signupComplete(@BodyParams() request: CompleteSignupRequest, @Context() ctx: PlatformContext) {
		throttle(ctx, completeAttempts);
		return this.auth.completeSignupPayment(request.token, request.payment, request.orderId);
	}

	@Post("/webhooks/:provider")
	async webhook(@PathParams("provider") provider: string, @RawBodyParams() rawBody: string | Buffer, @HeaderParams("stripe-signature") stripeSignature?: string, @HeaderParams("x-square-hmacsha256-signature") squareSignature?: string) {
		const raw = typeof rawBody === "string" ? rawBody : Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : JSON.stringify(rawBody ?? {});
		await this.payments.handleWebhook(provider, raw, provider === "stripe" ? stripeSignature : squareSignature);
		return { received: true };
	}

	@Get("/me")
	@Security("BearerAuth")
	async me(@HeaderParams("authorization") authorization?: string) {
		return this.payments.me(await this.auth.getAuthenticatedUser(authorization));
	}

	@Get("/plans")
	@Security("BearerAuth")
	async plans(@HeaderParams("authorization") authorization?: string) {
		return this.payments.listPlans(await this.auth.getAuthenticatedUser(authorization));
	}

	@Get("/offers/:itemId")
	@Security("BearerAuth")
	async offers(@PathParams("itemId") itemId: string, @HeaderParams("authorization") authorization?: string) {
		return this.payments.offersFor(await this.auth.getAuthenticatedUser(authorization), id(itemId, "Media item"));
	}

	/** Which of these items are locked for the caller, so lists can show a lock badge. */
	@Post("/access")
	@Security("BearerAuth")
	async access(@BodyParams() body: Body, @HeaderParams("authorization") authorization?: string) {
		const user = await this.auth.getAuthenticatedUser(authorization);
		if (!(await this.config.isActive())) {
			return { enabled: false, items: {} };
		}
		const ids = Array.isArray(body.ids) ? body.ids.filter(isUuid).map((value) => value.toLowerCase()) : [];
		if (ids.length > MAX_LOCK_CHECK) {
			throw new BadRequest(`Check at most ${MAX_LOCK_CHECK} items at a time.`);
		}
		return { enabled: true, items: await this.entitlements.lockStates(user, ids) };
	}

	@Post("/quote")
	@Security("BearerAuth")
	async quote(@BodyParams() body: Body, @HeaderParams("authorization") authorization?: string) {
		return this.payments.quote(await this.auth.getAuthenticatedUser(authorization), checkoutRequest(body));
	}

	@Post("/checkout")
	@Security("BearerAuth")
	async checkout(@BodyParams() body: Body, @HeaderParams("authorization") authorization?: string) {
		return this.payments.checkout(await this.auth.getAuthenticatedUser(authorization), checkoutRequest(body));
	}

	@Get("/orders/:orderId/receipt")
	@Security("BearerAuth")
	async receipt(@PathParams("orderId") orderId: string, @HeaderParams("authorization") authorization?: string) {
		const user = await this.auth.getAuthenticatedUser(authorization);
		return this.payments.receiptUrl(user.id, id(orderId, "Order"));
	}

	@Post("/orders/:orderId/confirm")
	@Security("BearerAuth")
	async confirm(@PathParams("orderId") orderId: string, @HeaderParams("authorization") authorization?: string) {
		const user = await this.auth.getAuthenticatedUser(authorization);
		return this.payments.confirmOrder(user.id, id(orderId, "Order"));
	}

	@Post("/methods/setup")
	@Security("BearerAuth")
	async beginMethod(@HeaderParams("authorization") authorization?: string) {
		return this.payments.beginMethodSetup(await this.auth.getAuthenticatedUser(authorization));
	}

	@Post("/methods")
	@Security("BearerAuth")
	async addMethod(@BodyParams() body: Body, @HeaderParams("authorization") authorization?: string) {
		const method = await this.payments.addMethod(await this.auth.getAuthenticatedUser(authorization), {
			setupIntentId: text(body.setupIntentId),
			sourceId: text(body.sourceId),
			verificationToken: text(body.verificationToken),
		});
		return { id: method.id, brand: method.brand, last4: method.last4, expMonth: method.expMonth, expYear: method.expYear, isDefault: method.isDefault };
	}

	@Post("/methods/:methodId/default")
	@Security("BearerAuth")
	async makeDefault(@PathParams("methodId") methodId: string, @HeaderParams("authorization") authorization?: string) {
		const user = await this.auth.getAuthenticatedUser(authorization);
		await this.payments.setDefaultMethod(user.id, id(methodId, "Card"));
		return { ok: true };
	}

	@Delete("/methods/:methodId")
	@Security("BearerAuth")
	async removeMethod(@PathParams("methodId") methodId: string, @HeaderParams("authorization") authorization?: string) {
		const user = await this.auth.getAuthenticatedUser(authorization);
		await this.payments.removeMethod(user.id, id(methodId, "Card"));
		return { ok: true };
	}

	@Post("/subscriptions/:subscriptionId/cancel")
	@Security("BearerAuth")
	async cancel(@PathParams("subscriptionId") subscriptionId: string, @HeaderParams("authorization") authorization?: string) {
		const user = await this.auth.getAuthenticatedUser(authorization);
		return this.payments.cancelSubscription(user.id, id(subscriptionId, "Subscription"));
	}

	@Post("/subscriptions/:subscriptionId/resume")
	@Security("BearerAuth")
	async resume(@PathParams("subscriptionId") subscriptionId: string, @HeaderParams("authorization") authorization?: string) {
		const user = await this.auth.getAuthenticatedUser(authorization);
		return this.payments.resumeSubscription(user.id, id(subscriptionId, "Subscription"));
	}
}

/** Everything an administrator configures: provider keys, catalogue, coupons, orders and refunds. */
@Controller("/admin/payments")
@Security("BearerAuth")
export class AdminPaymentsController {
	constructor(
		private readonly auth: AuthService,
		private readonly config: PaymentConfigService,
		private readonly catalog: PaymentCatalogService,
		private readonly payments: PaymentsService,
	) {}

	private async admin(authorization?: string) {
		await this.auth.requireAdmin(authorization);
	}

	@Get("/currencies")
	async currencies(@QueryParams("provider", String) provider?: string, @HeaderParams("authorization") authorization?: string) {
		await this.admin(authorization);
		return currenciesFor(provider === "square" ? "square" : provider === "stripe" ? "stripe" : null);
	}

	@Get("/config")
	async getConfig(@HeaderParams("authorization") authorization?: string) {
		await this.admin(authorization);
		return this.config.adminView();
	}

	@Put("/config")
	async putConfig(@BodyParams() body: Body, @HeaderParams("authorization") authorization?: string) {
		await this.admin(authorization);
		return this.config.update(object(body));
	}

	@Post("/config/test")
	async test(@BodyParams() body: Body, @HeaderParams("authorization") authorization?: string) {
		await this.admin(authorization);
		return this.config.testConnection(object(body));
	}

	@Get("/stats")
	async stats(@HeaderParams("authorization") authorization?: string) {
		await this.admin(authorization);
		return this.payments.stats();
	}

	@Get("/scope-search")
	async scopeSearch(@QueryParams("q", String) q: string, @QueryParams("type", String) type?: string, @HeaderParams("authorization") authorization?: string) {
		await this.admin(authorization);
		return this.catalog.searchScopes(q ?? "", type);
	}

	@Get("/products")
	async products(@HeaderParams("authorization") authorization?: string) {
		await this.admin(authorization);
		return this.catalog.listProducts();
	}

	@Post("/products")
	async createProduct(@BodyParams() body: Body, @HeaderParams("authorization") authorization?: string) {
		await this.admin(authorization);
		return this.catalog.saveProduct(null, body);
	}

	@Put("/products/:productId")
	async updateProduct(@PathParams("productId") productId: string, @BodyParams() body: Body, @HeaderParams("authorization") authorization?: string) {
		await this.admin(authorization);
		return this.catalog.saveProduct(id(productId, "Product"), body);
	}

	@Delete("/products/:productId")
	async deleteProduct(@PathParams("productId") productId: string, @HeaderParams("authorization") authorization?: string) {
		await this.admin(authorization);
		await this.catalog.deleteProduct(id(productId, "Product"));
		return { ok: true };
	}

	@Get("/plans")
	async plans(@HeaderParams("authorization") authorization?: string) {
		await this.admin(authorization);
		return this.catalog.listPlans();
	}

	@Post("/plans")
	async createPlan(@BodyParams() body: Body, @HeaderParams("authorization") authorization?: string) {
		await this.admin(authorization);
		return this.catalog.savePlan(null, body);
	}

	@Put("/plans/:planId")
	async updatePlan(@PathParams("planId") planId: string, @BodyParams() body: Body, @HeaderParams("authorization") authorization?: string) {
		await this.admin(authorization);
		return this.catalog.savePlan(id(planId, "Plan"), body);
	}

	@Delete("/plans/:planId")
	async deletePlan(@PathParams("planId") planId: string, @HeaderParams("authorization") authorization?: string) {
		await this.admin(authorization);
		await this.catalog.deletePlan(id(planId, "Plan"));
		return { ok: true };
	}

	@Get("/coupons")
	async coupons(@HeaderParams("authorization") authorization?: string) {
		await this.admin(authorization);
		return this.catalog.listCoupons();
	}

	@Post("/coupons")
	async createCoupon(@BodyParams() body: Body, @HeaderParams("authorization") authorization?: string) {
		await this.admin(authorization);
		return this.catalog.saveCoupon(null, body);
	}

	@Put("/coupons/:couponId")
	async updateCoupon(@PathParams("couponId") couponId: string, @BodyParams() body: Body, @HeaderParams("authorization") authorization?: string) {
		await this.admin(authorization);
		return this.catalog.saveCoupon(id(couponId, "Coupon"), body);
	}

	@Delete("/coupons/:couponId")
	async deleteCoupon(@PathParams("couponId") couponId: string, @HeaderParams("authorization") authorization?: string) {
		await this.admin(authorization);
		await this.catalog.deleteCoupon(id(couponId, "Coupon"));
		return { ok: true };
	}

	@Get("/orders")
	async orders(@QueryParams("page", String) page?: string, @QueryParams("status", String) status?: string, @QueryParams("userId", String) userId?: string, @HeaderParams("authorization") authorization?: string) {
		await this.admin(authorization);
		return this.payments.adminOrders(Math.max(0, Number.parseInt(page ?? "0", 10) || 0), 25, status, userId);
	}

	@Post("/orders/:orderId/refund")
	async refund(@PathParams("orderId") orderId: string, @BodyParams() body: Body, @HeaderParams("authorization") authorization?: string) {
		await this.admin(authorization);
		return this.payments.refund(id(orderId, "Order"), typeof body.amountMinor === "number" ? body.amountMinor : undefined);
	}

	@Get("/subscriptions")
	async subscriptions(@QueryParams("status", String) status?: string, @HeaderParams("authorization") authorization?: string) {
		await this.admin(authorization);
		return this.payments.adminSubscriptions(status);
	}

	@Post("/subscriptions/:subscriptionId/cancel")
	async cancelSubscription(@PathParams("subscriptionId") subscriptionId: string, @BodyParams() body: Body, @HeaderParams("authorization") authorization?: string) {
		await this.admin(authorization);
		return this.payments.cancelSubscription(null, id(subscriptionId, "Subscription"), body.immediately === true);
	}

	@Get("/users/:userId")
	async userOverview(@PathParams("userId") userId: string, @HeaderParams("authorization") authorization?: string) {
		await this.admin(authorization);
		return this.payments.adminUserOverview(id(userId, "User"));
	}

	@Post("/users/:userId/waive-signup")
	async waiveSignup(@PathParams("userId") userId: string, @HeaderParams("authorization") authorization?: string) {
		await this.admin(authorization);
		await this.payments.adminWaiveSignup(id(userId, "User"));
		return { ok: true };
	}

	@Delete("/users/:userId/methods/:methodId")
	async removeUserMethod(@PathParams("userId") userId: string, @PathParams("methodId") methodId: string, @HeaderParams("authorization") authorization?: string) {
		await this.admin(authorization);
		await this.payments.adminRemoveMethod(id(userId, "User"), id(methodId, "Card"));
		return { ok: true };
	}

	@Get("/users/:userId/grants")
	async grants(@PathParams("userId") userId: string, @HeaderParams("authorization") authorization?: string) {
		await this.admin(authorization);
		return this.payments.listGrants(id(userId, "User"));
	}

	/** Comp access: give a user a scope for free, optionally for a number of hours. */
	@Post("/users/:userId/grants")
	async grant(@PathParams("userId") userId: string, @BodyParams() body: Body, @HeaderParams("authorization") authorization?: string) {
		await this.admin(authorization);
		const hours = typeof body.hours === "number" && Number.isInteger(body.hours) && body.hours > 0 ? body.hours : null;
		return this.payments.adminGrant(id(userId, "User"), parseScope(body.scope), hours);
	}

	@Patch("/grants/:grantId/revoke")
	async revoke(@PathParams("grantId") grantId: string, @HeaderParams("authorization") authorization?: string) {
		await this.admin(authorization);
		await this.payments.adminRevoke(id(grantId, "Grant"));
		return { ok: true };
	}
}
