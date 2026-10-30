import { BadRequest, NotFound } from "@tsed/exceptions";
import { Inject, Injectable } from "@tsed/di";
import { Ajv2020 } from "ajv/dist/2020.js";
import { readFile, stat } from "node:fs/promises";
import { isAbsolute, resolve, sep } from "node:path";
import { DataSource } from "typeorm";
import { DefaultDataSource } from "../../datasources/defaultDataSource.datasource.js";
import { PluginInstallation } from "../../entities/pluginInstallation.entity.js";
import { SECRET_MASK } from "../settings/secretMask.js";
import { decryptPluginSettingSecret, encryptPluginSettingSecret } from "./pluginSettingsSecrets.js";

export interface PluginSettingsUpdate {
	values: Record<string, unknown>;
	secrets: Record<string, string>;
}

interface JsonSchemaProperty {
	type?: string;
	title?: string;
	description?: string;
	format?: string;
	items?: { type?: string };
	enum?: unknown[];
	default?: unknown;
	writeOnly?: boolean;
	"x-flixer-secret"?: boolean;
}

export interface PluginSettingsSchema {
	type: "object";
	properties: Record<string, JsonSchemaProperty>;
	[key: string]: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function secretSettingNames(schema: PluginSettingsSchema): Set<string> {
	return new Set(
		Object.entries(schema.properties ?? {})
			.filter(([, definition]) => definition?.writeOnly === true || definition?.["x-flixer-secret"] === true)
			.map(([name]) => name),
	);
}

function validateSchema(schema: PluginSettingsSchema) {
	if (!isRecord(schema) || schema.type !== "object" || !isRecord(schema.properties)) {
		throw new BadRequest("Plugin settings schema must describe an object with properties.");
	}
	for (const name of Object.keys(schema.properties)) {
		if (!/^[a-zA-Z][a-zA-Z0-9_.-]{0,127}$/.test(name) || Object.hasOwn(Object.prototype, name)) {
			throw new BadRequest(`Plugin settings schema contains an unsafe property name: ${name}.`);
		}
	}
	const pending: Array<{ value: unknown; depth: number }> = [{ value: schema, depth: 0 }];
	let nodeCount = 0;
	while (pending.length > 0) {
		const current = pending.pop()!;
		nodeCount += 1;
		if (nodeCount > 20_000 || current.depth > 64) {
			throw new BadRequest("Plugin settings schema exceeds complexity limits.");
		}
		if (Array.isArray(current.value)) {
			for (const item of current.value) pending.push({ value: item, depth: current.depth + 1 });
		} else if (isRecord(current.value)) {
			if (typeof current.value.$ref === "string" && !current.value.$ref.startsWith("#")) {
				throw new BadRequest("Plugin settings schema cannot reference external URLs.");
			}
			for (const child of Object.values(current.value)) pending.push({ value: child, depth: current.depth + 1 });
		}
	}
	for (const [name, property] of Object.entries(schema.properties)) {
		if (property.type && !["string", "number", "integer", "boolean", "array"].includes(property.type)) {
			throw new BadRequest(`Setting "${name}" uses an unsupported form type.`);
		}
		if (property.type === "array" && !["string", "number", "integer"].includes(property.items?.type ?? "")) {
			throw new BadRequest(`List setting "${name}" must contain strings or numbers.`);
		}
		if (
			property.enum &&
			property.enum.some((value) => value !== null && !["string", "number", "boolean"].includes(typeof value))
		) {
			throw new BadRequest(`Dropdown setting "${name}" must contain primitive options.`);
		}
		if (
			(property.writeOnly === true || property["x-flixer-secret"] === true) &&
			(property as { type?: string }).type !== "string"
		) {
			throw new BadRequest(`Secret setting "${name}" must use the string type.`);
		}
	}
	const ajv = new Ajv2020({ allErrors: true, strict: false });
	ajv.addFormat("uri", (value: string) => {
		try {
			const url = new URL(value);
			return url.protocol === "http:" || url.protocol === "https:";
		} catch {
			return false;
		}
	});
	const validate = ajv.compile(schema);
	return { validate, secrets: secretSettingNames(schema) };
}

@Injectable()
export class PluginSettingsService {
	constructor(@Inject(DefaultDataSource) private readonly dataSource: DataSource) {}

	async get(pluginId: string) {
		const installation = await this.findInstallation(pluginId);
		const schema = await this.loadSchema(installation);
		if (!schema) return { schema: null, values: {}, secretFields: [] as string[] };
		const { secrets } = validateSchema(schema);
		await this.migrateLegacySecrets(installation, secrets);
		const values = { ...installation.settings };
		for (const name of secrets) {
			values[name] = installation.encryptedSecrets[name] ? SECRET_MASK : "";
		}
		const publicSchema = structuredClone(schema);
		for (const name of secrets) delete publicSchema.properties?.[name]?.default;
		return { schema: publicSchema, values, secretFields: [...secrets] };
	}

	/** Stored values with schema defaults and decrypted secrets, for handing to the plugin itself. */
	async effectiveValues(installation: PluginInstallation): Promise<Record<string, unknown>> {
		const schema = await this.loadSchema(installation);
		if (!schema) return {};
		const { secrets } = validateSchema(schema);
		const properties = schema.properties ?? {};
		const values: Record<string, unknown> = {};
		for (const [name, property] of Object.entries(properties)) {
			if (!secrets.has(name) && property.default !== undefined) values[name] = property.default;
		}
		for (const [name, value] of Object.entries(installation.settings)) {
			if (Object.hasOwn(properties, name) && !secrets.has(name)) values[name] = value;
		}
		for (const name of secrets) {
			const encrypted = installation.encryptedSecrets[name];
			if (encrypted) values[name] = decryptPluginSettingSecret(installation.pluginId, name, encrypted);
		}
		return values;
	}

	async update(pluginId: string, request: PluginSettingsUpdate) {
		const installation = await this.findInstallation(pluginId);
		const schema = await this.loadSchema(installation);
		if (!schema) throw new BadRequest("This plugin does not declare a settings schema.");
		if (!isRecord(request?.values) || !isRecord(request?.secrets)) {
			throw new BadRequest("Plugin settings must include values and secrets objects.");
		}
		if (
			Buffer.byteLength(JSON.stringify(request.values)) + Buffer.byteLength(JSON.stringify(request.secrets)) >
			1_048_576
		) {
			throw new BadRequest("Plugin settings payload exceeds the 1 MiB size limit.");
		}

		const { validate, secrets } = validateSchema(schema);
		const properties = schema.properties ?? {};
		await this.migrateLegacySecrets(installation, secrets);
		const values = Object.fromEntries(
			Object.entries(installation.settings).filter(
				([name]) => Object.hasOwn(properties, name) && !secrets.has(name),
			),
		);
		const encryptedSecrets = { ...installation.encryptedSecrets };
		const effective = { ...values };

		for (const name of secrets) {
			if (encryptedSecrets[name])
				effective[name] = decryptPluginSettingSecret(pluginId, name, encryptedSecrets[name]!);
		}

		for (const [name, value] of Object.entries(request.values)) {
			if (!Object.hasOwn(properties, name) || secrets.has(name)) {
				throw new BadRequest(`Setting "${name}" must be submitted through the correct settings field.`);
			}
			values[name] = value;
			effective[name] = value;
		}

		for (const [name, value] of Object.entries(request.secrets)) {
			if (!secrets.has(name)) throw new BadRequest(`Setting "${name}" is not declared as a secret.`);
			if (typeof value !== "string" || Buffer.byteLength(value) > 65_536) {
				throw new BadRequest(`Secret setting "${name}" must be text up to 65536 bytes.`);
			}
			if (value === SECRET_MASK) continue;
			if (value === "") {
				delete encryptedSecrets[name];
				delete effective[name];
				continue;
			}
			encryptedSecrets[name] = encryptPluginSettingSecret(pluginId, name, value);
			effective[name] = value;
		}

		if (!validate(effective)) {
			const details = (validate.errors ?? [])
				.map((error) => `${error.instancePath || "/"} ${error.message ?? "is invalid"}`)
				.join("; ");
			throw new BadRequest(`Plugin settings are invalid: ${details}`);
		}
		if (Buffer.byteLength(JSON.stringify(values)) > 1_048_576) {
			throw new BadRequest("Plugin settings exceed the 1 MiB storage limit.");
		}

		installation.settings = values;
		installation.encryptedSecrets = encryptedSecrets;
		await this.dataSource.getRepository(PluginInstallation).save(installation);
		return this.get(pluginId);
	}

	private async findInstallation(pluginId: string): Promise<PluginInstallation> {
		const installation = await this.dataSource.getRepository(PluginInstallation).findOneBy({ pluginId });
		if (!installation) throw new NotFound("Installed plugin not found.");
		return installation;
	}

	private async migrateLegacySecrets(installation: PluginInstallation, secretNames: Set<string>): Promise<void> {
		let changed = false;
		const settings = { ...installation.settings };
		const encryptedSecrets = { ...installation.encryptedSecrets };
		for (const name of secretNames) {
			const legacy = settings[name];
			if (encryptedSecrets[name] || typeof legacy !== "string") continue;
			if (legacy !== "") encryptedSecrets[name] = encryptPluginSettingSecret(installation.pluginId, name, legacy);
			delete settings[name];
			changed = true;
		}
		if (!changed) return;
		installation.settings = settings;
		installation.encryptedSecrets = encryptedSecrets;
		await this.dataSource.getRepository(PluginInstallation).save(installation);
	}

	private async loadSchema(installation: PluginInstallation): Promise<PluginSettingsSchema | null> {
		const relativePath = installation.manifest.settingsSchema;
		if (!relativePath) return null;
		if (isAbsolute(relativePath) || relativePath.includes("\\"))
			throw new BadRequest("Plugin settings schema path is invalid.");
		const path = resolve(installation.installPath, relativePath);
		if (!path.startsWith(`${resolve(installation.installPath)}${sep}`))
			throw new BadRequest("Plugin settings schema escapes the package directory.");
		try {
			const info = await stat(path);
			if (!info.isFile() || info.size > 1_048_576) throw new Error("Plugin settings schema has an invalid size.");
			const schema: unknown = JSON.parse(await readFile(path, "utf8"));
			if (!isRecord(schema)) throw new Error("Plugin settings schema must be a JSON object.");
			return schema as PluginSettingsSchema;
		} catch (error: unknown) {
			throw new BadRequest(
				`Plugin settings schema could not be loaded: ${error instanceof Error ? error.message : "unknown error"}`,
			);
		}
	}
}
