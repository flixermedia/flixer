import { $log } from "@tsed/logger";

type Provider = "square" | "stripe";

const verificationRequired = "Your bank requires additional card verification. Try again or use a different card. If the problem continues, contact the server administrator.";
const declined = "Your card was declined. Check your card details or contact your bank, then try again.";
const insufficientFunds = "Your card has insufficient funds. Try a different card or contact your bank.";
const expiredCard = "Your card has expired. Use a different card.";
const incorrectSecurityCode = "The card security code is incorrect. Check it and try again.";
const incorrectPostalCode = "The card billing postal code is incorrect. Check it and try again.";

const messages: Record<Provider, Record<string, string>> = {
	square: {
		CARD_DECLINED_VERIFICATION_REQUIRED: verificationRequired,
		VERIFY_CVV_FAILURE: incorrectSecurityCode,
		VERIFY_AVS_FAILURE: incorrectPostalCode,
		CARD_EXPIRED: expiredCard,
		INSUFFICIENT_FUNDS: insufficientFunds,
		CARD_DECLINED: declined,
		CARD_DECLINED_CALL_ISSUER: declined,
		GENERIC_DECLINE: declined,
	},
	stripe: {
		authentication_required: verificationRequired,
		payment_intent_authentication_failure: "Card verification failed. Try again or use a different card.",
		insufficient_funds: insufficientFunds,
		expired_card: expiredCard,
		incorrect_cvc: incorrectSecurityCode,
		invalid_cvc: incorrectSecurityCode,
		incorrect_zip: incorrectPostalCode,
		card_declined: declined,
		generic_decline: declined,
	},
};

/** Returns a customer-safe message and logs provider codes without card details or provider response bodies. */
export function providerErrorMessage(provider: Provider, status: number, codes: (string | undefined)[]): string {
	const safeCodes = codes.filter((code): code is string => typeof code === "string" && /^[a-zA-Z0-9_]{1,80}$/.test(code));
	$log.warn({ event: "PAYMENT_PROVIDER_ERROR", provider, status, codes: safeCodes });
	if (status >= 500 || status === 429) return "The payment provider is temporarily unavailable. Please try again later.";
	for (const code of safeCodes) {
		if (Object.hasOwn(messages[provider], code)) return messages[provider][code];
	}
	return "The payment could not be processed. Please try again or contact the server administrator.";
}
