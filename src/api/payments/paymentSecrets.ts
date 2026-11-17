import { createHmac, timingSafeEqual } from "node:crypto";
import { appConfig } from "../../config/store/appConfig.js";
import { aesGcmDecrypt, aesGcmEncrypt, deriveAesKey } from "../../utils/aesGcm.js";

const CONTEXT = "flixer:payments:v1";
const AAD = Buffer.from(CONTEXT);

// The same derived key also signs the setup/pending/receipt tokens below.
function key(): Buffer {
	return deriveAesKey(appConfig().require("appSecret"), CONTEXT, "APP_SECRET must be at least 32 bytes to store payment credentials.");
}

/** Encrypts the payment provider credentials for storage using a key derived from APP_SECRET. */
export function encryptPaymentSecret(value: string): string {
	return aesGcmEncrypt(value, key(), AAD);
}

export function decryptPaymentSecret(value: string): string {
	return aesGcmDecrypt(value, key(), AAD, "Stored payment credentials are corrupted.");
}

const SETUP_TOKEN_TTL_MS = 30 * 60 * 1000;

function sign(payload: string): string {
	return createHmac("sha256", key()).update(`setup:${payload}`).digest("base64url");
}

/** Proves a provider customer was created by this server for a signup in progress, without storing anything. */
export function signSetupToken(provider: string, customerId: string, now = Date.now()): string {
	const payload = Buffer.from(JSON.stringify({ p: provider, c: customerId, e: now + SETUP_TOKEN_TTL_MS })).toString("base64url");
	return `${payload}.${sign(payload)}`;
}

export function verifySetupToken(token: string, provider: string, now = Date.now()): string | null {
	const [payload, signature] = token.split(".");
	if (!payload || !signature) {
		return null;
	}
	const expected = Buffer.from(sign(payload));
	const given = Buffer.from(signature);
	if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
		return null;
	}
	try {
		const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { p?: string; c?: string; e?: number };
		if (data.p !== provider || typeof data.c !== "string" || typeof data.e !== "number" || data.e < now) {
			return null;
		}
		return data.c;
	} catch {
		return null;
	}
}

const PENDING_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

function signPending(payload: string): string {
	return createHmac("sha256", key()).update(`pending-signup:${payload}`).digest("base64url");
}

/** Lets someone who registered but has not paid come back and finish, without a session. Only issued after the password was checked. */
export function signPendingSignupToken(userId: string, now = Date.now()): string {
	const payload = Buffer.from(JSON.stringify({ u: userId, e: now + PENDING_TOKEN_TTL_MS })).toString("base64url");
	return `${payload}.${signPending(payload)}`;
}

export function verifyPendingSignupToken(token: string, now = Date.now()): string | null {
	const [payload, signature] = token.split(".");
	if (!payload || !signature) {
		return null;
	}
	const expected = Buffer.from(signPending(payload));
	const given = Buffer.from(signature);
	if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
		return null;
	}
	try {
		const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { u?: string; e?: number };
		return typeof data.u === "string" && typeof data.e === "number" && data.e >= now ? data.u : null;
	} catch {
		return null;
	}
}

/** Receipt emails embed a poster, so the image URL carries a signature instead of needing a login. */
export function signReceiptArt(itemId: string): string {
	return createHmac("sha256", key()).update(`receipt-art:${itemId}`).digest("base64url");
}

export function verifyReceiptArt(itemId: string, signature: string): boolean {
	const expected = Buffer.from(signReceiptArt(itemId));
	const received = Buffer.from(signature);
	return received.length === expected.length && timingSafeEqual(received, expected);
}
