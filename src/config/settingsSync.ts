import { randomBytes } from "node:crypto";
import type { DataSource, EntityManager } from "typeorm";
import { Setting } from "../entities/setting.entity.js";
import { ADMIN_SCHEDULED_TASKS_SETTING, defaultAdminScheduledTaskConfigs } from "../jobs/adminScheduledTasks.js";
import settingsDefinitions from "./settings.json" with { type: "json" };

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

interface SettingDefinition {
	key: string;
	defaultValue: JsonValue;
	isPublic: boolean;
}

const SETTING_KEY_PATTERN = /^[a-zA-Z][a-zA-Z0-9_.-]{0,127}$/;
const REQUEST_WEBHOOK_TOKEN_SETTING = "requests_webhook_token";

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

		if (!("key" in item) || typeof item.key !== "string" || !SETTING_KEY_PATTERN.test(item.key) || !("defaultValue" in item) || !isJsonValue(item.defaultValue) || !("isPublic" in item) || typeof item.isPublic !== "boolean") {
			throw new Error(`Setting definition at index ${index} must include a valid key, defaultValue, and isPublic.`);
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

function readDefinitions(): SettingDefinition[] {
	return parseDefinitions(settingsDefinitions);
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

		if (definition.key === REQUEST_WEBHOOK_TOKEN_SETTING && (typeof existing.value !== "string" || existing.value.length < 32)) {
			existing.value = definition.defaultValue;
			settingsToSave.push(existing);
		}

		if (existing.isPublic !== definition.isPublic) {
			existing.isPublic = definition.isPublic;
			if (!settingsToSave.includes(existing)) settingsToSave.push(existing);
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
	const definitions = readDefinitions();
	if (definitions.some(({ key }) => key === ADMIN_SCHEDULED_TASKS_SETTING)) {
		throw new Error(`Setting "${ADMIN_SCHEDULED_TASKS_SETTING}" is defined more than once.`);
	}
	// Keep scheduler-owned preferences in the synchronized set so startup cannot discard saved schedules.
	const scheduledTaskDefaults = defaultAdminScheduledTaskConfigs();
	if (!isJsonValue(scheduledTaskDefaults)) {
		throw new Error(`Default value for "${ADMIN_SCHEDULED_TASKS_SETTING}" is not valid JSON.`);
	}
	definitions.push({
		key: ADMIN_SCHEDULED_TASKS_SETTING,
		defaultValue: scheduledTaskDefaults,
		isPublic: false,
	});
	definitions.push({
		key: REQUEST_WEBHOOK_TOKEN_SETTING,
		defaultValue: randomBytes(32).toString("hex"),
		isPublic: false,
	});
	await dataSource.transaction(async (manager) => {
		// RAW SQL: PostgreSQL advisory transaction lock function has no ORM equivalent.
		await manager.query("SELECT pg_advisory_xact_lock(hashtext($1))", ["flixer:sync-settings"]);
		await synchronizeDefinitions(manager, definitions);
	});
}
