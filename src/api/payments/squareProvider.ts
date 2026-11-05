import { randomUUID } from "node:crypto";
import type { CardSetupInput, ChargeInput, ChargeResult, PaymentProvider, ProviderCard } from "./paymentProvider.js";
import { PaymentProviderError } from "./paymentProvider.js";

const VERSION = "2025-01-23";
const TIMEOUT_MS = 20_000;

interface SquareErrorBody {
	errors?: { code?: string; detail?: string; category?: string }[];
}

interface SquareCard {
	id: string;
	card_brand?: string;
	last_4?: string;
	exp_month?: number;
	exp_year?: number;
}

interface SquarePayment {
	id: string;
	status: string;
	refunded_money?: { amount?: number };
	receipt_url?: string;
}

function toCard(card: SquareCard): ProviderCard {
	return {
		ref: card.id,
		brand: (card.card_brand ?? "card").toLowerCase().replaceAll("_", " "),
		last4: card.last_4 ?? "0000",
		expMonth: card.exp_month ?? 12,
		expYear: card.exp_year ?? new Date().getUTCFullYear(),
	};
}

/** Square over its REST API. Amounts are ad-hoc, so no catalog or subscription plans are needed in Square. */
export class SquareProvider implements PaymentProvider {
	readonly id = "square" as const;

	constructor(
		private readonly accessToken: string,
		private readonly environment: "sandbox" | "production",
		private readonly locationId: string,
	) {}

	private get base(): string {
		return this.environment === "production" ? "https://connect.squareup.com" : "https://connect.squareupsandbox.com";
	}

	private async call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
		let response: Response;
		try {
			response = await fetch(`${this.base}${path}`, {
				method,
				headers: {
					Authorization: `Bearer ${this.accessToken}`,
					"Square-Version": VERSION,
					"Content-Type": "application/json",
				},
				body: body === undefined ? undefined : JSON.stringify(body),
				signal: AbortSignal.timeout(TIMEOUT_MS),
			});
		} catch {
			throw new PaymentProviderError("Could not reach Square.", true);
		}
		const payload = (await response.json().catch(() => ({}))) as T & SquareErrorBody;
		if (!response.ok) {
			throw new PaymentProviderError(payload.errors?.[0]?.detail ?? `Square returned ${response.status}.`, response.status >= 500);
		}
		return payload;
	}

	async testConnection() {
		try {
			const { locations = [] } = await this.call<{ locations?: { id: string; name?: string; status?: string }[] }>("GET", "/v2/locations");
			const location = locations.find((entry) => entry.id === this.locationId);
			if (!location) {
				return { ok: false, detail: `The token works, but location ${this.locationId || "(none)"} was not found. Available: ${locations.map((entry) => entry.id).join(", ") || "none"}.` };
			}
			return { ok: true, detail: `Connected to ${location.name ?? location.id} (${this.environment}).` };
		} catch (error) {
			return { ok: false, detail: error instanceof Error ? error.message : "Could not connect to Square." };
		}
	}

	async createCustomer(input: { email: string | null; name: string | null; reference: string }): Promise<string> {
		const { customer } = await this.call<{ customer: { id: string } }>("POST", "/v2/customers", {
			idempotency_key: randomUUID(),
			email_address: input.email ?? undefined,
			given_name: input.name ?? undefined,
			reference_id: input.reference,
		});
		return customer.id;
	}

	async beginCardSetup(): Promise<{ clientSecret?: string }> {
		return {};
	}

	async completeCardSetup(customerId: string, input: CardSetupInput): Promise<ProviderCard> {
		if (!input.sourceId) {
			throw new PaymentProviderError("The card was not tokenized.");
		}
		const { card } = await this.call<{ card: SquareCard }>("POST", "/v2/cards", {
			idempotency_key: randomUUID(),
			source_id: input.sourceId,
			verification_token: input.verificationToken,
			card: { customer_id: customerId },
		});
		return toCard(card);
	}

	async removeCard(_customerId: string, cardRef: string): Promise<void> {
		await this.call("POST", `/v2/cards/${encodeURIComponent(cardRef)}/disable`, {});
	}

	async charge(input: ChargeInput): Promise<ChargeResult> {
		try {
			const { payment } = await this.call<{ payment: SquarePayment }>("POST", "/v2/payments", {
				idempotency_key: input.idempotencyKey,
				source_id: input.cardRef,
				customer_id: input.customerId,
				location_id: this.locationId,
				amount_money: { amount: input.amountMinor, currency: input.currency },
				autocomplete: true,
				note: input.description.slice(0, 500),
				reference_id: input.orderId,
			});
			return this.toResult(payment);
		} catch (error) {
			if (error instanceof PaymentProviderError && !error.retryable) {
				return { status: "failed", ref: null, error: error.message };
			}
			throw error;
		}
	}

	private toResult(payment: SquarePayment): ChargeResult {
		if (payment.status === "COMPLETED") {
			return { status: "succeeded", ref: payment.id, refundedMinor: payment.refunded_money?.amount, receiptUrl: payment.receipt_url };
		}
		if (payment.status === "APPROVED" || payment.status === "PENDING") {
			return { status: "failed", ref: payment.id, error: "The payment is still pending." };
		}
		return { status: "failed", ref: payment.id, error: "The payment did not go through." };
	}

	async retrieveCharge(ref: string): Promise<ChargeResult> {
		const { payment } = await this.call<{ payment: SquarePayment }>("GET", `/v2/payments/${encodeURIComponent(ref)}`);
		return this.toResult(payment);
	}

	async refund(input: { ref: string; amountMinor: number; currency: string; idempotencyKey: string }): Promise<void> {
		await this.call("POST", "/v2/refunds", {
			idempotency_key: input.idempotencyKey,
			payment_id: input.ref,
			amount_money: { amount: input.amountMinor, currency: input.currency },
		});
	}
}
