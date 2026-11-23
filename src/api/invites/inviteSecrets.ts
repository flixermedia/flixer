import { appConfig } from "../../config/store/appConfig.js";
import { aesGcmDecrypt, aesGcmEncrypt, deriveAesKey } from "../../utils/aesGcm.js";

const CONTEXT = "flixer:invites:v1";
const AAD = Buffer.from(CONTEXT);

function key(): Buffer {
	return deriveAesKey(appConfig().get("appSecret") ?? "", CONTEXT, "APP_SECRET must be set to at least 32 bytes to store media server credentials.");
}

/** Encrypts a media server API key with a key derived from APP_SECRET. Changing that secret makes saved keys unreadable. */
export function encryptSecret(plain: string): string {
	return aesGcmEncrypt(plain, key(), AAD);
}

export function decryptSecret(encrypted: string): string {
	return aesGcmDecrypt(encrypted, key(), AAD, "The saved API key is corrupted.");
}
