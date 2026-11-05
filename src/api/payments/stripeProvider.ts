import type { CardSetupInput, ChargeInput, ChargeResult, PaymentProvider, ProviderCard } from "./paymentProvider.js";
import { PaymentProviderError } from "./paymentProvider.js";

const API = "https://api.stripe.com/v1";
const TIMEOUT_MS = 20_000;

type Form = Record<string, string | number | boolean | undefined>;

interface StripeError {
	message?: string;
	code?: string;
	payment_intent?: StripePaymentIntent;
}

interface StripePaymentIntent {
	id: string;
	status: string;
	client_secret?: string;
	last_payment_error?: { message?: string } | null;
	latest_charge?: string | { amount_refunded?: number; receipt_url?: string | null } | null;
}

interface StripePaymentMethod {
	id: string;
	card?: { brand: string; last4: string; exp_month: number; exp_year: number };
}

function encode(form: Form): string {
	const body = new URLSearchParams();
	for (const [name, value] of Object.entries(form)) {
		if (value !== undefined) {
			body.append(name, String(value));
		}
	}
	return body.toString();
}

function toCard(method: StripePaymentMethod): ProviderCard {
	if (!method.card) {
		throw new PaymentProviderError("Only card payment methods are supported.");
	}
	return {
		ref: method.id,
		brand: method.card.brand,
		last4: method.card.last4,
		expMonth: method.card.exp_month,
		expYear: method.card.exp_year,
	};
}

/** Stripe over its REST API. Amounts are ad-hoc, so nothing needs to be configured in the Stripe dashboard. */
export class StripeProvider implements PaymentProvider {
	readonly id = "stripe" as const;

	constructor(private readonly secretKey: string) {}

	private async call<T>(method: "GET" | "POST" | "DELETE", path: string, form?: Form, idempotencyKey?: string): Promise<T> {
		let response: Response;
		try {
			response = await fetch(`${API}${path}`, {
				method,
				headers: {
					Authorization: `Bearer ${this.secretKey}`,
					"Content-Type": "application/x-www-form-urlencoded",
					...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
				},
				body: form ? encode(form) : undefined,
				signal: AbortSignal.timeout(TIMEOUT_MS),
			});
		} catch {
			throw new PaymentProviderError("Could not reach Stripe.", true);
		}
		const payload = (await response.json().catch(() => ({}))) as T & { error?: StripeError };
		if (!response.ok) {
			const error = payload.error;
			throw Object.assign(new PaymentProviderError(error?.message ?? `Stripe returned ${response.status}.`, response.status >= 500), {
				intent: error?.payment_intent,
			});
		}
		return payload;
	}

	async testConnection() {
		if (!/^(sk|rk)_(test|live)_/.test(this.secretKey)) {
			return { ok: false, detail: "The secret key must start with sk_ or rk_." };
		}
		try {
			const account = await this.call<{ id: string; livemode?: boolean; charges_enabled?: boolean; business_profile?: { name?: string } }>("GET", "/account");
			const name = account.business_profile?.name ?? account.id;
			return {
				ok: true,
				detail: `Connected to ${name} (${this.secretKey.includes("_live_") ? "live" : "test"} mode)${account.charges_enabled === false ? ", but charges are not enabled on the account" : ""}.`,
			};
		} catch (error) {
			return { ok: false, detail: error instanceof Error ? error.message : "Could not connect to Stripe." };
		}
	}

	async createCustomer(input: { email: string | null; name: string | null; reference: string }): Promise<string> {
		const customer = await this.call<{ id: string }>("POST", "/customers", {
			email: input.email ?? undefined,
			name: input.name ?? undefined,
			"metadata[flixer_ref]": input.reference,
		});
		return customer.id;
	}

	async beginCardSetup(customerId: string): Promise<{ clientSecret?: string }> {
		const intent = await this.call<StripePaymentIntent>("POST", "/setup_intents", {
			customer: customerId,
			usage: "off_session",
			"automatic_payment_methods[enabled]": true,
			"automatic_payment_methods[allow_redirects]": "never",
			...cardOnlyParams(),
		});
		return { clientSecret: intent.client_secret };
	}

	async completeCardSetup(customerId: string, input: CardSetupInput): Promise<ProviderCard> {
		if (!input.setupIntentId) {
			throw new PaymentProviderError("The card was not confirmed.");
		}
		const intent = await this.call<{ status: string; customer: string | null; payment_method: string | null }>("GET", `/setup_intents/${encodeURIComponent(input.setupIntentId)}`);
		if (intent.status !== "succeeded" || intent.customer !== customerId || !intent.payment_method) {
			throw new PaymentProviderError("The card could not be verified. Try again or use a different card.");
		}
		await this.call("POST", `/customers/${customerId}`, { "invoice_settings[default_payment_method]": intent.payment_method });
		return toCard(await this.call<StripePaymentMethod>("GET", `/payment_methods/${encodeURIComponent(intent.payment_method)}`));
	}

	async removeCard(_customerId: string, cardRef: string): Promise<void> {
		await this.call("POST", `/payment_methods/${encodeURIComponent(cardRef)}/detach`, {});
	}

	async charge(input: ChargeInput): Promise<ChargeResult> {
		try {
			const intent = await this.call<StripePaymentIntent>(
				"POST",
				"/payment_intents",
				{
					amount: input.amountMinor,
					currency: input.currency.toLowerCase(),
					customer: input.customerId,
					payment_method: input.cardRef,
					confirm: true,
					description: input.description.slice(0, 500),
					"metadata[order_id]": input.orderId,
					...(input.interactive ? { "automatic_payment_methods[enabled]": true, "automatic_payment_methods[allow_redirects]": "never", ...cardOnlyParams() } : { off_session: true }),
				},
				input.idempotencyKey,
			);
			return this.toResult(intent);
		} catch (error) {
			const intent = (error as { intent?: StripePaymentIntent }).intent;
			if (intent) {
				return { status: "failed", ref: intent.id, error: error instanceof Error ? error.message : "The card was declined." };
			}
			if (error instanceof PaymentProviderError && !error.retryable) {
				return { status: "failed", ref: null, error: error.message };
			}
			throw error;
		}
	}

	private toResult(intent: StripePaymentIntent): ChargeResult {
		const charge = typeof intent.latest_charge === "object" ? intent.latest_charge : null;
		const refunded = charge?.amount_refunded;
		if (intent.status === "succeeded") {
			return { status: "succeeded", ref: intent.id, refundedMinor: refunded, receiptUrl: charge?.receipt_url ?? undefined };
		}
		if (intent.status === "requires_action") {
			return { status: "requires_action", ref: intent.id, clientSecret: intent.client_secret };
		}
		return { status: "failed", ref: intent.id, error: intent.last_payment_error?.message ?? "The payment did not go through." };
	}

	async retrieveCharge(ref: string): Promise<ChargeResult> {
		return this.toResult(await this.call<StripePaymentIntent>("GET", `/payment_intents/${encodeURIComponent(ref)}?expand[]=latest_charge`));
	}

	async refund(input: { ref: string; amountMinor: number; idempotencyKey: string }): Promise<void> {
		await this.call("POST", "/refunds", { payment_intent: input.ref, amount: input.amountMinor }, input.idempotencyKey);
	}
}

// Flixer only supports cards; the account's dashboard may enable other methods (wallets, bank redirects) that Flixer cannot complete.
const NON_CARD_METHODS = [
	"acss_debit", "affirm", "afterpay_clearpay", "alipay", "alma", "amazon_pay", "au_becs_debit", "bacs_debit", "bancontact", "billie", "bizum",
	"blik", "boleto", "cashapp", "crypto", "customer_balance", "eps", "fpx", "giropay", "grabpay", "ideal", "kakao_pay", "klarna", "konbini", "kr_card",
	"mb_way", "mobilepay", "multibanco", "naver_pay", "nz_bank_account", "oxxo", "p24", "pay_by_bank", "payco", "paynow", "paypal", "paypay", "payto", "pix",
	"promptpay", "revolut_pay", "samsung_pay", "satispay", "scalapay", "sepa_debit", "sequra", "sofort", "sunbit", "swish", "twint", "upi", "us_bank_account", "wechat_pay", "wero", "zip",
];

function cardOnlyParams(): Record<string, string> {
	return Object.fromEntries(NON_CARD_METHODS.map((type, index) => [`excluded_payment_method_types[${index}]`, type]));
}
