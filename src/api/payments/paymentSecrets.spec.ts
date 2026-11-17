import { beforeAll, describe, expect, it } from "vitest";
import { decryptPaymentSecret, encryptPaymentSecret, signPendingSignupToken, signSetupToken, verifyPendingSignupToken, verifySetupToken } from "./paymentSecrets.js";

beforeAll(() => {
	process.env.APP_SECRET = "test-secret-for-payments-0123456789";
});

describe("payment secrets", () => {
	it("round-trips encrypted values", () => {
		const encrypted = encryptPaymentSecret("sk_test_123");
		expect(encrypted).not.toContain("sk_test_123");
		expect(decryptPaymentSecret(encrypted)).toBe("sk_test_123");
	});

	it("verifies setup tokens and rejects tampering, other providers and expiry", () => {
		const now = Date.now();
		const token = signSetupToken("stripe", "cus_1", now);
		expect(verifySetupToken(token, "stripe", now)).toBe("cus_1");
		expect(verifySetupToken(token, "square", now)).toBeNull();
		expect(verifySetupToken(`${token}x`, "stripe", now)).toBeNull();
		expect(verifySetupToken(token, "stripe", now + 31 * 60 * 1000)).toBeNull();
	});

	it("verifies pending-signup tokens and rejects tampering, setup tokens and expiry", () => {
		const now = Date.now();
		const token = signPendingSignupToken("user-1", now);
		expect(verifyPendingSignupToken(token, now)).toBe("user-1");
		expect(verifyPendingSignupToken(`${token}x`, now)).toBeNull();
		expect(verifyPendingSignupToken(signSetupToken("stripe", "cus_1", now), now)).toBeNull();
		expect(verifyPendingSignupToken(token, now + 25 * 60 * 60 * 1000)).toBeNull();
	});
});
