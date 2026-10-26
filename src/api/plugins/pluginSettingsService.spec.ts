import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DataSource, Repository } from "typeorm";
import { afterEach, describe, expect, it } from "vitest";
import { PluginInstallation } from "../../entities/pluginInstallation.entity.js";
import { SECRET_MASK } from "../settings/secretMask.js";
import { decryptPluginSettingSecret, encryptPluginSettingSecret } from "./pluginSettingsSecrets.js";
import { PluginSettingsService } from "./pluginSettingsService.js";

const previousSecret = process.env.APP_SECRET;

afterEach(() => {
	if (previousSecret === undefined) delete process.env.APP_SECRET;
	else process.env.APP_SECRET = previousSecret;
});

describe("PluginSettingsService", () => {
	it("persists write-only values encrypted and returns only a mask", async () => {
		process.env.APP_SECRET = "test-plugin-app-secret-that-is-long-enough";
		const { service, installation, cleanup } = await createService();
		try {
			const result = await service.update(installation.pluginId, {
				values: { language: "fr" },
				secrets: { apiKey: "private-token" },
			});
			expect(result.values).toEqual({ language: "fr", apiKey: SECRET_MASK });
			expect(installation.settings).toEqual({ language: "fr" });
			expect(installation.encryptedSecrets.apiKey).not.toContain("private-token");
			expect(
				decryptPluginSettingSecret(installation.pluginId, "apiKey", installation.encryptedSecrets.apiKey!),
			).toBe("private-token");
		} finally {
			await cleanup();
		}
	});

	it("preserves a secret when the masked value is submitted again", async () => {
		process.env.APP_SECRET = "test-plugin-app-secret-that-is-long-enough";
		const { service, installation, cleanup } = await createService();
		try {
			await service.update(installation.pluginId, {
				values: { language: "en" },
				secrets: { apiKey: "private-token" },
			});
			const ciphertext = installation.encryptedSecrets.apiKey;
			await service.update(installation.pluginId, { values: {}, secrets: { apiKey: SECRET_MASK } });
			expect(installation.encryptedSecrets.apiKey).toBe(ciphertext);
		} finally {
			await cleanup();
		}
	});

	it("rejects values that do not match the declared settings schema", async () => {
		const { service, installation, cleanup } = await createService();
		try {
			await expect(
				service.update(installation.pluginId, { values: { language: "xx" }, secrets: {} }),
			).rejects.toThrow("Plugin settings are invalid");
		} finally {
			await cleanup();
		}
	});

	it("validates URL-formatted settings on the backend", async () => {
		const schema = {
			type: "object",
			properties: { homepage: { type: "string", format: "uri" } },
		};
		const { service, installation, cleanup } = await createService(schema);
		try {
			await expect(
				service.update(installation.pluginId, { values: { homepage: "javascript:alert(1)" }, secrets: {} }),
			).rejects.toThrow("Plugin settings are invalid");
		} finally {
			await cleanup();
		}
	});

	it("migrates legacy plaintext secrets and strips secret schema defaults", async () => {
		process.env.APP_SECRET = "test-plugin-app-secret-that-is-long-enough";
		const { service, installation, cleanup } = await createService();
		installation.settings = { language: "en", apiKey: "legacy-plain-value" };
		try {
			const result = await service.get(installation.pluginId);
			expect(result.values.apiKey).toBe(SECRET_MASK);
			expect(installation.settings).toEqual({ language: "en" });
			expect(
				decryptPluginSettingSecret(installation.pluginId, "apiKey", installation.encryptedSecrets.apiKey!),
			).toBe("legacy-plain-value");
			expect(result.schema?.properties.apiKey).not.toHaveProperty("default");
		} finally {
			await cleanup();
		}
	});

	it.each([
		["prototype property", JSON.parse('{"type":"object","properties":{"__proto__":{"type":"string"}}}')],
		["external reference", { type: "object", properties: { value: { $ref: "https://example.org/schema.json" } } }],
		["inherited property", { type: "object", properties: { toString: { type: "string" } } }],
		["non-string secret", { type: "object", properties: { token: { type: "number", writeOnly: true } } }],
	])("rejects %s in plugin settings schemas", async (_name, schema) => {
		const { service, installation, cleanup } = await createService(schema as Record<string, unknown>);
		try {
			await expect(service.get(installation.pluginId)).rejects.toThrow();
		} finally {
			await cleanup();
		}
	});

	it("drops stale values removed from a newer settings schema", async () => {
		process.env.APP_SECRET = "test-plugin-app-secret-that-is-long-enough";
		const { service, installation, cleanup } = await createService();
		installation.settings = { language: "en", removedField: "stale" };
		installation.encryptedSecrets = {
			apiKey: encryptPluginSettingSecret(installation.pluginId, "apiKey", "kept-token"),
		};
		try {
			await service.update(installation.pluginId, { values: { language: "fr" }, secrets: {} });
			expect(installation.settings).toEqual({ language: "fr" });
		} finally {
			await cleanup();
		}
	});

	it("rejects inherited property names in submitted settings", async () => {
		const { service, installation, cleanup } = await createService();
		try {
			await expect(
				service.update(installation.pluginId, { values: { toString: "bad" }, secrets: {} }),
			).rejects.toThrow("correct settings field");
		} finally {
			await cleanup();
		}
	});
});

async function createService(
	schema: Record<string, unknown> = {
		type: "object",
		additionalProperties: false,
		required: ["language", "apiKey"],
		properties: {
			language: { type: "string", enum: ["en", "fr"] },
			apiKey: { type: "string", writeOnly: true, minLength: 1, default: "secret-default" },
		},
	},
) {
	const root = await mkdtemp(join(tmpdir(), "flixer-plugin-settings-"));
	await writeFile(join(root, "settings.schema.json"), JSON.stringify(schema));
	const installation = {
		pluginId: "flixer.example",
		installPath: root,
		manifest: { settingsSchema: "settings.schema.json" },
		settings: {},
		encryptedSecrets: {},
	} as PluginInstallation;
	const repository = {
		findOneBy: async () => installation,
		save: async (value: PluginInstallation) => Object.assign(installation, value),
	} as unknown as Repository<PluginInstallation>;
	const dataSource = { getRepository: () => repository } as unknown as DataSource;
	return {
		service: new PluginSettingsService(dataSource),
		installation,
		cleanup: () => rm(root, { recursive: true, force: true }),
	};
}
