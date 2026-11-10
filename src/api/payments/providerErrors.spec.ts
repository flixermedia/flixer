import { afterEach, describe, expect, it, vi } from "vitest";
import { $log } from "@tsed/logger";
import { PaymentProviderError, type ChargeInput } from "./paymentProvider.js";
import { SquareProvider } from "./squareProvider.js";
import { StripeProvider } from "./stripeProvider.js";

const charge: ChargeInput = {
	customerId: "customer",
	cardRef: "card",
	amountMinor: 999,
	currency: "GBP",
	description: "Registration",
	idempotencyKey: "order",
	interactive: true,
	orderId: "order",
};

function respond(body: unknown, status = 400) {
	vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })));
}

describe("payment provider error messages", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it("translates Square verification errors for card setup and charges", async () => {
		const warn = vi.spyOn($log, "warn").mockImplementation(() => $log);
		respond({ errors: [{ code: "CARD_DECLINED_VERIFICATION_REQUIRED", detail: "Authorization error: 'CARD_DECLINED_VERIFICATION_REQUIRED'" }] }, 402);
		const provider = new SquareProvider("token", "sandbox", "location");
		await expect(provider.completeCardSetup("customer", { sourceId: "source" })).rejects.toThrow(/bank requires additional card verification/i);
		await expect(provider.charge(charge)).resolves.toMatchObject({ status: "failed", error: expect.stringMatching(/additional card verification/i) });
		expect(warn).toHaveBeenCalledWith({ event: "PAYMENT_PROVIDER_ERROR", provider: "square", status: 402, codes: ["CARD_DECLINED_VERIFICATION_REQUIRED"] });
	});

	it.each([
		["VERIFY_CVV_FAILURE", /security code/i],
		["VERIFY_AVS_FAILURE", /postal code/i],
		["CARD_EXPIRED", /expired/i],
		["INSUFFICIENT_FUNDS", /insufficient funds/i],
		["CARD_DECLINED", /declined/i],
	])("explains Square error %s", async (code, message) => {
		vi.spyOn($log, "warn").mockImplementation(() => $log);
		respond({ errors: [{ code, detail: "technical details" }] });
		await expect(new SquareProvider("token", "sandbox", "location").charge(charge)).resolves.toMatchObject({ status: "failed", error: expect.stringMatching(message) });
	});

	it("uses Stripe decline codes and preserves administrative connection diagnostics", async () => {
		vi.spyOn($log, "warn").mockImplementation(() => $log);
		respond({ error: { code: "card_declined", decline_code: "insufficient_funds", message: "provider detail" } }, 402);
		const provider = new StripeProvider("sk_test_example");
		await expect(provider.charge(charge)).resolves.toMatchObject({ status: "failed", error: expect.stringMatching(/insufficient funds/i) });
		await expect(provider.testConnection()).resolves.toEqual({ ok: false, detail: "provider detail" });
	});

	it("preserves Square connection diagnostics for administrators", async () => {
		vi.spyOn($log, "warn").mockImplementation(() => $log);
		respond({ errors: [{ code: "UNAUTHORIZED", detail: "The access token is invalid." }] }, 401);
		await expect(new SquareProvider("token", "sandbox", "location").testConnection()).resolves.toEqual({ ok: false, detail: "The access token is invalid." });
	});

	it("translates Stripe payment intent errors returned in successful responses", async () => {
		vi.spyOn($log, "warn").mockImplementation(() => $log);
		respond({ id: "pi", status: "requires_payment_method", last_payment_error: { code: "authentication_required", message: "raw" } }, 200);
		await expect(new StripeProvider("sk_test_example").retrieveCharge("pi")).resolves.toMatchObject({ status: "failed", error: expect.stringMatching(/additional card verification/i) });
	});

	it("does not expose unknown provider details and retains retryability", async () => {
		const warn = vi.spyOn($log, "warn").mockImplementation(() => $log);
		respond({ errors: [{ code: "unexpected private content!", detail: "sensitive provider detail" }] }, 429);
		try {
			await new SquareProvider("token", "sandbox", "location").completeCardSetup("customer", { sourceId: "source" });
			throw new Error("expected provider error");
		} catch (error) {
			expect(error).toBeInstanceOf(PaymentProviderError);
			expect(error).toMatchObject({ message: expect.stringMatching(/temporarily unavailable/i), retryable: true });
			expect((error as Error).message).not.toContain("sensitive provider detail");
		}
		expect(warn).toHaveBeenCalledWith({ event: "PAYMENT_PROVIDER_ERROR", provider: "square", status: 429, codes: [] });
	});

	it("gives a safe fallback for unknown declines", async () => {
		vi.spyOn($log, "warn").mockImplementation(() => $log);
		respond({ errors: [{ code: "SOME_NEW_ERROR", detail: "private technical details" }] }, 402);
		await expect(new SquareProvider("token", "sandbox", "location").charge(charge)).resolves.toEqual({
			status: "failed",
			ref: null,
			error: "The payment could not be processed. Please try again or contact the server administrator.",
		});
	});
});
