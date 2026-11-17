import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

const NONCE_BYTES = 12;
const TAG_BYTES = 16;

/** Derives a 32-byte key bound to `context`, so each feature gets a key unusable by the others. */
export function deriveAesKey(secret: string, context: string, tooShortMessage: string): Buffer {
	if (Buffer.byteLength(secret) < 32) {
		throw new Error(tooShortMessage);
	}
	return Buffer.from(hkdfSync("sha256", Buffer.from(secret), Buffer.alloc(0), context, 32));
}

/** Encrypts with AES-256-GCM; output is base64url of nonce + ciphertext + auth tag. */
export function aesGcmEncrypt(plain: string, key: Buffer, aad: Buffer): string {
	const nonce = randomBytes(NONCE_BYTES);
	const cipher = createCipheriv("aes-256-gcm", key, nonce);
	cipher.setAAD(aad);
	const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
	return Buffer.concat([nonce, body, cipher.getAuthTag()]).toString("base64url");
}

/** Reverses `aesGcmEncrypt`; throws `corruptedMessage` when the payload is too short to be valid. */
export function aesGcmDecrypt(encoded: string, key: Buffer, aad: Buffer, corruptedMessage: string): string {
	const raw = Buffer.from(encoded, "base64url");
	if (raw.length < NONCE_BYTES + TAG_BYTES) {
		throw new Error(corruptedMessage);
	}
	const decipher = createDecipheriv("aes-256-gcm", key, raw.subarray(0, NONCE_BYTES));
	decipher.setAAD(aad);
	decipher.setAuthTag(raw.subarray(raw.length - TAG_BYTES));
	return Buffer.concat([decipher.update(raw.subarray(NONCE_BYTES, raw.length - TAG_BYTES)), decipher.final()]).toString("utf8");
}
