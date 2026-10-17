import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { DataSource, EntityManager } from "typeorm";
import { Setting } from "../entities/setting.entity.js";

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

interface SettingDefinition {
	key: string;
	defaultValue: JsonValue;
	isPublic: boolean;
}

const SETTINGS_FILE = join(process.cwd(), "src", "config", "settings.json");
const SETTING_KEY_PATTERN = /^[a-zA-Z][a-zA-Z0-9_.-]{0,127}$/;

function isJsonValue(value: unknown): value is JsonValue {

	if (value === null || typeof value === "string" || typeof value === "boolean") {
		return true;
	}
	if (typeof value === "number") {
		return Number.isFinite(value);
	}
	if (Array.isArray(value)) {
		return value.every(isJsonValue);
	}
	if (typeof value === "object") {
		return Object.values(value).every(isJsonValue);
	}

	return false;

}

function parseDefinitions(value: unknown): SettingDefinition[] {

	if (!Array.isArray(value)) {
		throw new Error("settings.json must contain an array of setting definitions.");
	}

	const keys = new Set<string>();
	return value.map((item, index) => {
		if (typeof item !== "object" || item === null || Array.isArray(item)) {
			throw new Error(`Setting definition at index ${index} must be an object.`);
		}

		if (
			!("key" in item) ||
			typeof item.key !== "string" ||
			!SETTING_KEY_PATTERN.test(item.key) ||
			!("defaultValue" in item) ||
			!isJsonValue(item.defaultValue) ||
			!("isPublic" in item) ||
			typeof item.isPublic !== "boolean"
		) {
			throw new Error(
				`Setting definition at index ${index} must include a valid key, defaultValue, and isPublic.`,
			);
		}

		if (keys.has(item.key)) {
			throw new Error(`settings.json contains duplicate setting key "${item.key}".`);
		}
		keys.add(item.key);

		return {
			key: item.key,
			defaultValue: item.defaultValue,
			isPublic: item.isPublic,
		};
	});

}

async function readDefinitions(): Promise<SettingDefinition[]> {

	const contents = await readFile(SETTINGS_FILE, "utf8");
	let parsed: unknown;
	try {
		parsed = JSON.parse(contents);
	} catch (error) {
		throw new Error(`Unable to parse ${SETTINGS_FILE}.`, { cause: error });
	}

	return parseDefinitions(parsed);

}

async function synchronizeDefinitions(manager: EntityManager, definitions: SettingDefinition[]): Promise<void> {

	const repository = manager.getRepository(Setting);
	const existingSettings = await repository.find();
	const definitionsByKey = new Map(definitions.map((definition) => [definition.key, definition]));
	const existingByKey = new Map(existingSettings.map((setting) => [setting.key, setting]));
	const settingsToSave: Setting[] = [];

	for (const definition of definitions) {
		const existing = existingByKey.get(definition.key);
		if (!existing) {
			settingsToSave.push(
				repository.create({
					key: definition.key,
					value: definition.defaultValue,
					isPublic: definition.isPublic,
				}),
			);
			continue;
		}

		if (existing.isPublic !== definition.isPublic) {
			existing.isPublic = definition.isPublic;
			settingsToSave.push(existing);
		}
	}

	const removedSettings = existingSettings.filter((setting) => !definitionsByKey.has(setting.key));
	if (removedSettings.length > 0) {
		await repository.remove(removedSettings);
	}
	if (settingsToSave.length > 0) {
		await repository.save(settingsToSave);
	}

}

export async function synchronizeSettings(dataSource: DataSource): Promise<void> {

	const definitions = await readDefinitions();
	await dataSource.transaction(async (manager) => {
		await manager.query("SELECT pg_advisory_xact_lock(hashtext($1))", ["flixer:sync-settings"]);
		await synchronizeDefinitions(manager, definitions);
	});

}
