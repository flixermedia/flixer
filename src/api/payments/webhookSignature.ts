import { createHmac, timingSafeEqual } from "node:crypto";

/** Stripe rejects deliveries older than this to blunt replays. */
export const STRIPE_TOLERANCE_SECONDS = 5 * 60;

function safeEqual(a: string, b: string): boolean {
	const left = Buffer.from(a);
	const right = Buffer.from(b);
	return left.length === right.length && timingSafeEqual(left, right);
}

/** Verifies a `Stripe-Signature` header (`t=...,v1=...`) over `${t}.${rawBody}`. */
export function verifyStripeSignature(rawBody: string, header: string | undefined, secret: string, nowSeconds = Math.floor(Date.now() / 1000)): boolean {
	if (!header || !secret) {
		return false;
	}
	let timestamp = "";
	const signatures: string[] = [];
	for (const part of header.split(",")) {
		const [key, value] = part.split("=", 2).map((entry) => entry.trim());
		if (key === "t") {
			timestamp = value ?? "";
		} else if (key === "v1" && value) {
			signatures.push(value);
		}
	}
	const issuedAt = Number(timestamp);
	if (!Number.isFinite(issuedAt) || Math.abs(nowSeconds - issuedAt) > STRIPE_TOLERANCE_SECONDS) {
		return false;
	}
	const expected = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
	return signatures.some((signature) => safeEqual(signature, expected));
}

/** Verifies `x-square-hmacsha256-signature`: base64 HMAC-SHA256 over the notification URL followed by the raw body. */
export function verifySquareSignature(rawBody: string, header: string | undefined, signatureKey: string, notificationUrl: string): boolean {
	if (!header || !signatureKey || !notificationUrl) {
		return false;
	}
	const expected = createHmac("sha256", signatureKey)
		.update(notificationUrl + rawBody)
		.digest("base64");
	return safeEqual(header.trim(), expected);
}
