import type { PaymentProviderId } from "./paymentTypes.js";

export interface ProviderCard {
	ref: string;
	brand: string;
	last4: string;
	expMonth: number;
	expYear: number;
}

export interface ChargeInput {
	customerId: string;
	cardRef: string;
	amountMinor: number;
	currency: string;
	description: string;
	idempotencyKey: string;
	/** The customer is present and can complete 3-D Secure; renewals are off-session and cannot. */
	interactive: boolean;
	orderId: string;
}

export interface ChargeResult {
	status: "succeeded" | "requires_action" | "failed";
	ref: string | null;
	clientSecret?: string;
	error?: string;
	refundedMinor?: number;
	receiptUrl?: string;
}

export interface CardSetupInput {
	setupIntentId?: string;
	sourceId?: string;
	verificationToken?: string;
}

/** Everything Flixer needs from a payment processor. Each method throws {@link PaymentProviderError} on API failures. */
export interface PaymentProvider {
	readonly id: PaymentProviderId;
	testConnection(): Promise<{ ok: boolean; detail: string }>;
	createCustomer(input: { email: string | null; name: string | null; reference: string }): Promise<string>;
	/** Stripe needs a SetupIntent for the card element; Square tokenizes in the browser and needs nothing. */
	beginCardSetup(customerId: string): Promise<{ clientSecret?: string }>;
	completeCardSetup(customerId: string, input: CardSetupInput): Promise<ProviderCard>;
	removeCard(customerId: string, cardRef: string): Promise<void>;
	charge(input: ChargeInput): Promise<ChargeResult>;
	retrieveCharge(ref: string): Promise<ChargeResult>;
	refund(input: { ref: string; amountMinor: number; currency: string; idempotencyKey: string }): Promise<void>;
}

export class PaymentProviderError extends Error {
	constructor(
		message: string,
		readonly retryable = false,
		readonly diagnosticMessage = message,
	) {
		super(message);
		this.name = "PaymentProviderError";
	}
}
