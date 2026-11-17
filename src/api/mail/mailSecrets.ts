import { appConfig } from "../../config/store/appConfig.ts";
import { aesGcmDecrypt, aesGcmEncrypt, deriveAesKey } from "../../utils/aesGcm.ts";

const CONTEXT = "flixer:mail-dkim:v1";
const AAD = Buffer.from(CONTEXT);

function key(): Buffer {
	return deriveAesKey(appConfig().require("appSecret"), CONTEXT, "APP_SECRET must be at least 32 bytes to store mail signing keys.");
}

/** Encrypts a DKIM private key for storage using a key derived from APP_SECRET. */
export function encryptMailSecret(value: string): string {
	return aesGcmEncrypt(value, key(), AAD);
}

export function decryptMailSecret(value: string): string {
	return aesGcmDecrypt(value, key(), AAD, "A stored mail signing key is corrupted.");
}
