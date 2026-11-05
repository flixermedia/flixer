import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifySquareSignature, verifyStripeSignature } from "./webhookSignature.js";

describe("verifyStripeSignature", () => {
	const secret = "whsec_test";
	const body = '{"id":"evt_1"}';
	const now = 1_800_000_000;
	const sign = (t: number, payload = body) => createHmac("sha256", secret).update(`${t}.${payload}`).digest("hex");

	it("accepts a valid signature", () => {
		expect(verifyStripeSignature(body, `t=${now},v1=${sign(now)}`, secret, now)).toBe(true);
	});

	it("accepts when any v1 signature matches", () => {
		expect(verifyStripeSignature(body, `t=${now},v1=deadbeef,v1=${sign(now)}`, secret, now)).toBe(true);
	});

	it("rejects tampered bodies, wrong secrets, stale timestamps and missing headers", () => {
		expect(verifyStripeSignature(`${body} `, `t=${now},v1=${sign(now)}`, secret, now)).toBe(false);
		expect(verifyStripeSignature(body, `t=${now},v1=${sign(now)}`, "other", now)).toBe(false);
		expect(verifyStripeSignature(body, `t=${now - 600},v1=${sign(now - 600)}`, secret, now)).toBe(false);
		expect(verifyStripeSignature(body, undefined, secret, now)).toBe(false);
	});
});

describe("verifySquareSignature", () => {
	const key = "square-key";
	const url = "https://flixer.example.com/api/payments/webhooks/square";
	const body = '{"event_id":"e1"}';
	const header = createHmac("sha256", key)
		.update(url + body)
		.digest("base64");

	it("accepts a valid signature", () => {
		expect(verifySquareSignature(body, header, key, url)).toBe(true);
	});

	it("rejects a different URL, body, key or missing header", () => {
		expect(verifySquareSignature(body, header, key, `${url}/`)).toBe(false);
		expect(verifySquareSignature(`${body} `, header, key, url)).toBe(false);
		expect(verifySquareSignature(body, header, "nope", url)).toBe(false);
		expect(verifySquareSignature(body, undefined, key, url)).toBe(false);
	});
});
