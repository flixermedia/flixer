import { MaxLength, Property, Required } from "@tsed/schema";

export class SignupPaymentRequest {
	@Property()
	@MaxLength(2000)
	setupToken?: string;

	/** Stripe: the confirmed SetupIntent. */
	@Property()
	@MaxLength(200)
	setupIntentId?: string;

	/** Square: the card nonce from the Web Payments SDK. */
	@Property()
	@MaxLength(500)
	sourceId?: string;

	@Property()
	@MaxLength(500)
	verificationToken?: string;

	@Property()
	@MaxLength(64)
	couponCode?: string;

	@Property()
	@MaxLength(3)
	currency?: string;
}

export class SignupPaymentTokenRequest {
	/** The token returned when the account was created or when sign-in found it still unpaid. */
	@Property()
	@Required()
	@MaxLength(1000)
	token!: string;
}

export class CompleteSignupRequest extends SignupPaymentTokenRequest {
	@Property()
	payment?: SignupPaymentRequest;

	/** Set after the browser finished the card's extra authentication for the order a previous attempt returned. */
	@Property()
	@MaxLength(64)
	orderId?: string;
}
