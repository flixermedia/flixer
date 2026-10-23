import { createDecipheriv, createCipheriv, hkdfSync, randomBytes } from "node:crypto";
import { appConfig } from "../../config/store/appConfig.js";

const CONTEXT = "flixer:network-shares:v1";
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

function key(): Buffer {
	const secret = appConfig().get("streamTokenSecret") ?? "";
	if (Buffer.byteLength(secret) < 32) {
		throw new Error("STREAM_TOKEN_SECRET must be set to at least 32 bytes to store network share passwords.");
	}
	return Buffer.from(hkdfSync("sha256", Buffer.from(secret), Buffer.alloc(0), CONTEXT, 32));
}

/** Encrypts a share password with a key derived from STREAM_TOKEN_SECRET. Changing that secret makes saved passwords unreadable. */
export function encryptSecret(plain: string): string {
	const nonce = randomBytes(NONCE_BYTES);
	const cipher = createCipheriv("aes-256-gcm", key(), nonce);
	cipher.setAAD(Buffer.from(CONTEXT));
	const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
	return Buffer.concat([nonce, body, cipher.getAuthTag()]).toString("base64url");
}

export function decryptSecret(encrypted: string): string {
	const raw = Buffer.from(encrypted, "base64url");
	if (raw.length < NONCE_BYTES + TAG_BYTES) {
		throw new Error("The saved password is corrupted.");
	}
	const decipher = createDecipheriv("aes-256-gcm", key(), raw.subarray(0, NONCE_BYTES));
	decipher.setAAD(Buffer.from(CONTEXT));
	decipher.setAuthTag(raw.subarray(raw.length - TAG_BYTES));
	return Buffer.concat([decipher.update(raw.subarray(NONCE_BYTES, raw.length - TAG_BYTES)), decipher.final()]).toString("utf8");
}
