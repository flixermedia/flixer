import { appConfig } from "../../config/store/appConfig.js";
import { aesGcmDecrypt, aesGcmEncrypt, deriveAesKey } from "../../utils/aesGcm.js";

const CONTEXT = "flixer:oidc-client-secret:v1";
const AAD = Buffer.from(CONTEXT);

// Keyed from jwtSecret, not appSecret, so it stays separate from other Flixer secrets.
function key(): Buffer {
	return deriveAesKey(appConfig().require("jwtSecret"), CONTEXT, "The Flixer login secret must be at least 32 bytes to protect OAuth client secrets.");
}

/** Encrypts an OAuth client secret using a key separate from other Flixer secrets. */
export function encryptOidcSecret(secret: string): string {
	return aesGcmEncrypt(secret, key(), AAD);
}

export function decryptOidcSecret(value: string): string {
	return aesGcmDecrypt(value, key(), AAD, "The OAuth client secret is corrupt.");
}
