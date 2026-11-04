import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { appConfig } from "../../config/store/appConfig.js";

const CONTEXT = "flixer:mail-dkim:v1";
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

function key(): Buffer {
	const secret = appConfig().require("appSecret");
	if (Buffer.byteLength(secret) < 32) {
		throw new Error("APP_SECRET must be at least 32 bytes to store mail signing keys.");
	}
	return Buffer.from(hkdfSync("sha256", Buffer.from(secret), Buffer.alloc(0), CONTEXT, 32));
}

/** Encrypts a DKIM private key for storage using a key derived from APP_SECRET. */
export function encryptMailSecret(value: string): string {
	const nonce = randomBytes(NONCE_BYTES);
	const cipher = createCipheriv("aes-256-gcm", key(), nonce);
	cipher.setAAD(Buffer.from(CONTEXT));
	const body = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
	return Buffer.concat([nonce, body, cipher.getAuthTag()]).toString("base64url");
}

export function decryptMailSecret(value: string): string {
	const raw = Buffer.from(value, "base64url");
	if (raw.length < NONCE_BYTES + TAG_BYTES) {
		throw new Error("A stored mail signing key is corrupted.");
	}
	const decipher = createDecipheriv("aes-256-gcm", key(), raw.subarray(0, NONCE_BYTES));
	decipher.setAAD(Buffer.from(CONTEXT));
	decipher.setAuthTag(raw.subarray(raw.length - TAG_BYTES));
	return Buffer.concat([decipher.update(raw.subarray(NONCE_BYTES, raw.length - TAG_BYTES)), decipher.final()]).toString("utf8");
}
