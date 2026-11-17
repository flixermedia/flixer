import { afterEach, describe, expect, it } from "vitest";
import { decryptPluginSettingSecret, encryptPluginSettingSecret } from "./pluginSettingsSecrets.js";

const previousSecret = process.env.APP_SECRET;

afterEach(() => {
	if (previousSecret === undefined) delete process.env.APP_SECRET;
	else process.env.APP_SECRET = previousSecret;
});

describe("plugin settings secrets", () => {
	it("encrypts and decrypts a value using APP_SECRET", () => {
		process.env.APP_SECRET = "test-plugin-app-secret-that-is-long-enough";
		const encrypted = encryptPluginSettingSecret("flixer.example", "apiKey", "private-value");
		expect(encrypted).not.toContain("private-value");
		expect(decryptPluginSettingSecret("flixer.example", "apiKey", encrypted)).toBe("private-value");
	});

	it("authenticates the plugin and setting name", () => {
		process.env.APP_SECRET = "test-plugin-app-secret-that-is-long-enough";
		const encrypted = encryptPluginSettingSecret("flixer.example", "apiKey", "private-value");
		expect(() => decryptPluginSettingSecret("flixer.other", "apiKey", encrypted)).toThrow();
		expect(() => decryptPluginSettingSecret("flixer.example", "other", encrypted)).toThrow();
	});
});
