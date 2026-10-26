import { Inject, Injectable } from "@tsed/di";
import { BadRequest } from "@tsed/exceptions";
import { DataSource, type EntityManager } from "typeorm";
import { DefaultDataSource } from "../../datasources/defaultDataSource.datasource.js";
import {
	PluginStorageEntry,
	type PluginStorageJsonValue,
	type PluginStorageScope,
} from "../../entities/pluginStorageEntry.entity.js";

const MAX_STORAGE_BYTES = 256 * 1024;
const MAX_STORAGE_KEYS = 1024;
const STORAGE_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export const PLUGIN_STORAGE_PERMISSIONS = {
	pluginRead: "storage.plugin.read",
	pluginWrite: "storage.plugin.write",
	userRead: "storage.user.read",
	userWrite: "storage.user.write",
} as const;

export type PluginStoragePermissions = ReadonlySet<string>;
export type PluginStorageSnapshot = Partial<Record<PluginStorageScope, Record<string, PluginStorageJsonValue>>>;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function permissionFor(scope: PluginStorageScope, mode: "read" | "write"): string {
	return scope === "plugin"
		? mode === "read"
			? PLUGIN_STORAGE_PERMISSIONS.pluginRead
			: PLUGIN_STORAGE_PERMISSIONS.pluginWrite
		: mode === "read"
			? PLUGIN_STORAGE_PERMISSIONS.userRead
			: PLUGIN_STORAGE_PERMISSIONS.userWrite;
}

function ownerIdFor(scope: PluginStorageScope, pluginId: string, userId: string): string {
	return scope === "plugin" ? pluginId : userId;
}

function isJsonValue(value: unknown): value is PluginStorageJsonValue {
	const pending = [value];
	let visited = 0;
	while (pending.length > 0) {
		const current = pending.pop();
		visited += 1;
		if (visited > 100_000) return false;
		if (
			current === null ||
			typeof current === "string" ||
			typeof current === "boolean" ||
			(typeof current === "number" && Number.isFinite(current))
		) {
			continue;
		}
		if (Array.isArray(current)) {
			for (const item of current) pending.push(item);
			continue;
		}
		if (isRecord(current)) {
			for (const item of Object.values(current)) pending.push(item);
			continue;
		}
		return false;
	}
	return true;
}

@Injectable()
export class PluginStorageService {
	constructor(@Inject(DefaultDataSource) private readonly dataSource: DataSource) {}

	async load(
		pluginId: string,
		userId: string,
		permissions: PluginStoragePermissions,
	): Promise<PluginStorageSnapshot> {
		const scopes = (["plugin", "user"] as const).filter((scope) => permissions.has(permissionFor(scope, "read")));
		if (scopes.length === 0) return {};

		const where = scopes.map((scope) => ({
			pluginId,
			scope,
			ownerId: ownerIdFor(scope, pluginId, userId),
		}));
		const entries = await this.dataSource.getRepository(PluginStorageEntry).find({ where });
		const snapshot: PluginStorageSnapshot = {};
		for (const scope of scopes) snapshot[scope] = {};
		for (const entry of entries) {
			const values = snapshot[entry.scope];
			if (!values) throw new Error("Plugin storage returned an unexpected scope.");
			values[entry.key] = entry.value;
		}
		for (const scope of scopes) this.validateDocument(snapshot[scope]!);
		return snapshot;
	}

	async save(
		pluginId: string,
		userId: string,
		storage: unknown,
		permissions: PluginStoragePermissions,
	): Promise<void> {
		if (!isRecord(storage)) throw new Error("Plugin storage response must be an object.");
		const writes: Array<{
			scope: PluginStorageScope;
			values: Record<string, PluginStorageJsonValue>;
			deleteKeys: string[];
		}> = [];
		for (const [scopeName, values] of Object.entries(storage)) {
			if (scopeName !== "plugin" && scopeName !== "user") {
				throw new Error("Plugin storage response contains an unknown scope.");
			}
			const scope: PluginStorageScope = scopeName;
			if (!permissions.has(permissionFor(scope, "write"))) {
				throw new Error("Plugin storage response exceeds its approved permissions.");
			}
			if (!isRecord(values)) throw new Error("Plugin storage patch must be an object.");
			if (Object.keys(values).some((key) => key !== "set" && key !== "delete")) {
				throw new Error("Plugin storage patch contains an unknown operation.");
			}
			const set = values.set ?? {};
			const remove = values.delete ?? [];
			if (!isRecord(set) || !Array.isArray(remove) || !remove.every((key) => typeof key === "string")) {
				throw new Error("Plugin storage patch must contain an object of values and a list of keys to delete.");
			}
			this.validateDocument(set);
			if (Object.keys(set).length + remove.length > MAX_STORAGE_KEYS) {
				throw new BadRequest(`Plugin storage patches cannot contain more than ${MAX_STORAGE_KEYS} keys.`);
			}
			const deleteKeys: string[] = [];
			for (const key of remove) {
				if (typeof key !== "string") throw new Error("Plugin storage delete keys must be strings.");
				deleteKeys.push(key);
			}
			if (new Set(deleteKeys).size !== deleteKeys.length) {
				throw new BadRequest("Plugin storage patch contains duplicate keys to delete.");
			}
			for (const key of deleteKeys) {
				if (!STORAGE_KEY_PATTERN.test(key)) throw new BadRequest("Plugin storage contains an invalid key.");
				if (Object.hasOwn(set, key)) {
					throw new BadRequest("A plugin storage key cannot be set and deleted in the same patch.");
				}
			}
			if (Buffer.byteLength(JSON.stringify({ set, delete: deleteKeys })) > MAX_STORAGE_BYTES) {
				throw new BadRequest("Plugin storage patch exceeds the 256 KiB per-scope limit.");
			}
			writes.push({ scope, values: set, deleteKeys });
		}
		if (writes.length === 0) return;

		await this.dataSource.transaction(async (manager) => {
			for (const { scope, values, deleteKeys } of writes) {
				await this.applyPatch(manager, pluginId, userId, scope, values, deleteKeys);
			}
		});
	}

	private validateDocument(
		values: Record<string, unknown>,
	): asserts values is Record<string, PluginStorageJsonValue> {
		if (Object.keys(values).length > MAX_STORAGE_KEYS) {
			throw new BadRequest(`Plugin storage cannot contain more than ${MAX_STORAGE_KEYS} keys.`);
		}
		for (const key of Object.keys(values)) {
			if (!STORAGE_KEY_PATTERN.test(key)) throw new BadRequest("Plugin storage contains an invalid key.");
			if (!isJsonValue(values[key])) throw new BadRequest("Plugin storage values must be JSON data.");
		}
		if (Buffer.byteLength(JSON.stringify(values)) > MAX_STORAGE_BYTES) {
			throw new BadRequest("Plugin storage exceeds the 256 KiB per-scope limit.");
		}
	}

	private async applyPatch(
		manager: EntityManager,
		pluginId: string,
		userId: string,
		scope: PluginStorageScope,
		values: Record<string, PluginStorageJsonValue>,
		deleteKeys: string[],
	): Promise<void> {
		const ownerId = ownerIdFor(scope, pluginId, userId);
		await manager.query("SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))", [
			`${pluginId}:${scope}`,
			ownerId,
		]);
		const repository = manager.getRepository(PluginStorageEntry);
		const currentEntries = await repository.find({ where: { pluginId, scope, ownerId } });
		const current: Record<string, PluginStorageJsonValue> = Object.fromEntries(
			currentEntries.map((entry) => [entry.key, entry.value]),
		);
		for (const key of deleteKeys) delete current[key];
		Object.assign(current, values);
		this.validateDocument(current);

		if (deleteKeys.length > 0) {
			await manager.query(
				`DELETE FROM "plugin_storage"
				WHERE "plugin_id" = $1 AND "scope" = $2 AND "owner_id" = $3 AND "key" = ANY($4::varchar[])`,
				[pluginId, scope, ownerId, deleteKeys],
			);
		}
		const entries = Object.entries(values).map(([key, value]) => ({
			key,
			value,
		}));
		if (entries.length > 0) {
			const parameters: string[] = [];
			const rows = entries.map((entry, index) => {
				const offset = index * 5;
				const serializedValue = JSON.stringify(entry.value);
				if (serializedValue === undefined) throw new Error("Plugin storage value could not be serialized.");
				parameters.push(pluginId, scope, ownerId, entry.key, serializedValue);
				return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}::jsonb, now())`;
			});
			await manager.query(
				`INSERT INTO "plugin_storage" ("plugin_id", "scope", "owner_id", "key", "value", "updated_at")
				VALUES ${rows.join(", ")}
				ON CONFLICT ("plugin_id", "scope", "owner_id", "key")
				DO UPDATE SET "value" = EXCLUDED."value", "updated_at" = now()`,
				parameters,
			);
		}
	}
}
