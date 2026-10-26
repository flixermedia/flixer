import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { appConfig } from "../../config/store/appConfig.js";

const CONTEXT = "flixer:plugin-settings:v1";
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

function key(pluginId: string): Buffer {
	const secret = appConfig().require("appSecret");
	if (Buffer.byteLength(secret) < 32) {
		throw new Error("APP_SECRET must be at least 32 bytes to store plugin secrets.");
	}
	return Buffer.from(hkdfSync("sha256", Buffer.from(secret), Buffer.alloc(0), `${CONTEXT}:${pluginId}`, 32));
}

function aad(pluginId: string, settingName: string): Buffer {
	return Buffer.from(`${CONTEXT}:${pluginId}:${settingName}`);
}

export function encryptPluginSettingSecret(pluginId: string, settingName: string, value: string): string {
	const nonce = randomBytes(NONCE_BYTES);
	const cipher = createCipheriv("aes-256-gcm", key(pluginId), nonce);
	cipher.setAAD(aad(pluginId, settingName));
	const body = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
	return Buffer.concat([nonce, body, cipher.getAuthTag()]).toString("base64url");
}

export function decryptPluginSettingSecret(pluginId: string, settingName: string, encrypted: string): string {
	const raw = Buffer.from(encrypted, "base64url");
	if (raw.length < NONCE_BYTES + TAG_BYTES) throw new Error("A saved plugin secret is corrupted.");
	const decipher = createDecipheriv("aes-256-gcm", key(pluginId), raw.subarray(0, NONCE_BYTES));
	decipher.setAAD(aad(pluginId, settingName));
	decipher.setAuthTag(raw.subarray(raw.length - TAG_BYTES));
	return Buffer.concat([
		decipher.update(raw.subarray(NONCE_BYTES, raw.length - TAG_BYTES)),
		decipher.final(),
	]).toString("utf8");
}
