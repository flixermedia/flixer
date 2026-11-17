import { appConfig } from "../../config/store/appConfig.js";
import { aesGcmDecrypt, aesGcmEncrypt, deriveAesKey } from "../../utils/aesGcm.js";

const CONTEXT = "flixer:network-shares:v1";
const AAD = Buffer.from(CONTEXT);

function key(): Buffer {
	return deriveAesKey(appConfig().get("appSecret") ?? "", CONTEXT, "APP_SECRET must be set to at least 32 bytes to store network share passwords.");
}

/** Encrypts a share password with a key derived from APP_SECRET. Changing that secret makes saved passwords unreadable. */
export function encryptSecret(plain: string): string {
	return aesGcmEncrypt(plain, key(), AAD);
}

export function decryptSecret(encrypted: string): string {
	return aesGcmDecrypt(encrypted, key(), AAD, "The saved password is corrupted.");
}
