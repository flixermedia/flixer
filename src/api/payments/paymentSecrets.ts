import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";
import { appConfig } from "../../config/store/appConfig.js";

const CONTEXT = "flixer:payments:v1";
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

function key(): Buffer {
	const secret = appConfig().require("appSecret");
	if (Buffer.byteLength(secret) < 32) {
		throw new Error("APP_SECRET must be at least 32 bytes to store payment credentials.");
	}
	return Buffer.from(hkdfSync("sha256", Buffer.from(secret), Buffer.alloc(0), CONTEXT, 32));
}

/** Encrypts the payment provider credentials for storage using a key derived from APP_SECRET. */
export function encryptPaymentSecret(value: string): string {
	const nonce = randomBytes(NONCE_BYTES);
	const cipher = createCipheriv("aes-256-gcm", key(), nonce);
	cipher.setAAD(Buffer.from(CONTEXT));
	const body = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
	return Buffer.concat([nonce, body, cipher.getAuthTag()]).toString("base64url");
}

export function decryptPaymentSecret(value: string): string {
	const raw = Buffer.from(value, "base64url");
	if (raw.length < NONCE_BYTES + TAG_BYTES) {
		throw new Error("Stored payment credentials are corrupted.");
	}
	const decipher = createDecipheriv("aes-256-gcm", key(), raw.subarray(0, NONCE_BYTES));
	decipher.setAAD(Buffer.from(CONTEXT));
	decipher.setAuthTag(raw.subarray(raw.length - TAG_BYTES));
	return Buffer.concat([decipher.update(raw.subarray(NONCE_BYTES, raw.length - TAG_BYTES)), decipher.final()]).toString("utf8");
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
