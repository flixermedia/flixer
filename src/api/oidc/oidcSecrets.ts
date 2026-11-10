import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { appConfig } from "../../config/store/appConfig.js";

const CONTEXT = "flixer:oidc-client-secret:v1";

function key(): Buffer {
	const secret = appConfig().require("jwtSecret");
	if (Buffer.byteLength(secret) < 32) throw new Error("The Flixer login secret must be at least 32 bytes to protect OAuth client secrets.");
	return Buffer.from(hkdfSync("sha256", Buffer.from(secret), Buffer.alloc(0), CONTEXT, 32));
}

/** Encrypts an OAuth client secret using a key separate from other Flixer secrets. */
export function encryptOidcSecret(secret: string): string {
	const nonce = randomBytes(12);
	const cipher = createCipheriv("aes-256-gcm", key(), nonce);
	cipher.setAAD(Buffer.from(CONTEXT));
	const body = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
	return Buffer.concat([nonce, body, cipher.getAuthTag()]).toString("base64url");
}

export function decryptOidcSecret(value: string): string {
	const data = Buffer.from(value, "base64url");
	if (data.length < 28) throw new Error("The OAuth client secret is corrupt.");
	const decipher = createDecipheriv("aes-256-gcm", key(), data.subarray(0, 12));
	decipher.setAAD(Buffer.from(CONTEXT));
	decipher.setAuthTag(data.subarray(-16));
	return Buffer.concat([decipher.update(data.subarray(12, -16)), decipher.final()]).toString("utf8");
}
