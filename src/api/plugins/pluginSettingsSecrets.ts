import { appConfig } from "../../config/store/appConfig.ts";
import { aesGcmDecrypt, aesGcmEncrypt, deriveAesKey } from "../../utils/aesGcm.ts";

const CONTEXT = "flixer:plugin-settings:v1";

// Key and AAD are scoped per plugin/setting so a value cannot be replayed under another one.
function key(pluginId: string): Buffer {
	return deriveAesKey(appConfig().require("appSecret"), `${CONTEXT}:${pluginId}`, "APP_SECRET must be at least 32 bytes to store plugin secrets.");
}

function aad(pluginId: string, settingName: string): Buffer {
	return Buffer.from(`${CONTEXT}:${pluginId}:${settingName}`);
}

export function encryptPluginSettingSecret(pluginId: string, settingName: string, value: string): string {
	return aesGcmEncrypt(value, key(pluginId), aad(pluginId, settingName));
}

export function decryptPluginSettingSecret(pluginId: string, settingName: string, encrypted: string): string {
	return aesGcmDecrypt(encrypted, key(pluginId), aad(pluginId, settingName), "A saved plugin secret is corrupted.");
}
