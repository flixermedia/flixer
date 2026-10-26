import { createHash } from "node:crypto";
import { Inject, Injectable } from "@tsed/di";
import { DataSource } from "typeorm";
import { DefaultDataSource } from "../../datasources/defaultDataSource.datasource.js";
import type { PluginInstallation } from "../../entities/pluginInstallation.entity.js";
import type { PluginColumnDefinition, PluginColumnType, PluginTableDefinition } from "./pluginManifest.js";

export const DATABASE_PERMISSION = "database.tables";
const MAX_ROWS = 200;
const DEFAULT_ROWS = 50;
const MAX_INSERT_ROWS = 50;
const MAX_IN_VALUES = 100;
const MAX_CONDITIONS = 16;
const MAX_TEXT_BYTES = 65_536;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SQL_TYPE: Record<PluginColumnType, string> = {
	text: "text",
	integer: "integer",
	boolean: "boolean",
	timestamp: "timestamptz",
	json: "jsonb",
	uuid: "uuid",
};

const COMPARISONS: Record<string, string> = {
	eq: "=",
	ne: "<>",
	gt: ">",
	gte: ">=",
	lt: "<",
	lte: "<=",
	like: "LIKE",
	ilike: "ILIKE",
};

export class PluginDatabaseError extends Error {
	constructor(readonly code: "invalid_request" | "not_found" | "request_failed") {
		super(code);
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalid(): never {
	throw new PluginDatabaseError("invalid_request");
}

/** The real table name: the plugin id is hashed so different ids can never share a table. */
export function pluginTableName(pluginId: string, table: string): string {
	return `plugin_${createHash("sha256").update(pluginId).digest("hex").slice(0, 12)}_${table}`;
}

function quote(identifier: string): string {
	return `"${identifier.replaceAll('"', '""')}"`;
}

function literalDefault(column: PluginColumnDefinition): string | null {
	const value = column.default;
	if (value === undefined || value === null) return null;
	if (column.type === "timestamp") {
		if (value === "now") return "now()";
		invalid();
	}
	if (column.type === "boolean") return typeof value === "boolean" ? String(value) : invalid();
	if (column.type === "integer") return typeof value === "number" && Number.isInteger(value) ? String(value) : invalid();
	if (column.type === "text") return typeof value === "string" ? `'${value.replaceAll("'", "''")}'` : invalid();
	return invalid();
}

function columnSql(name: string, column: PluginColumnDefinition, forAdd: boolean): string {
	const defaultSql = literalDefault(column);
	const notNull = column.nullable === false || column.primary === true;
	if (forAdd && notNull && defaultSql === null) invalid();
	return `${quote(name)} ${SQL_TYPE[column.type]}${defaultSql === null ? "" : ` DEFAULT ${defaultSql}`}${notNull ? " NOT NULL" : ""}`;
}

type Condition = { col: string; cmp: string; value?: unknown };
interface WhereClause {
	all: Condition[];
	any: Condition[][];
}

/** Gives each plugin its own Postgres tables, created from its manifest and reachable only through structured calls. */
@Injectable()
export class PluginDatabaseService {
	private readonly provisioned = new Set<string>();

	constructor(@Inject(DefaultDataSource) private readonly dataSource: DataSource) {}

	/** Creates missing tables, columns and indexes. It never drops or alters anything that exists. */
	async ensure(installation: PluginInstallation): Promise<void> {
		const tables = installation.manifest.database?.tables;
		if (!tables) return;
		const marker = `${installation.pluginId}@${installation.packageDigest}`;
		if (this.provisioned.has(marker)) return;
		for (const [name, definition] of Object.entries(tables)) {
			await this.provisionTable(installation.pluginId, name, definition);
		}
		this.provisioned.add(marker);
	}

	private async provisionTable(pluginId: string, name: string, definition: PluginTableDefinition) {
		const table = quote(pluginTableName(pluginId, name));
		const columns = Object.entries(definition.columns);
		const primary = columns.filter(([, column]) => column.primary).map(([column]) => quote(column));
		if (primary.length === 0) invalid();
		const existing = await this.dataSource.query(
			`SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1`,
			[pluginTableName(pluginId, name)],
		);
		if (existing.length === 0) {
			await this.dataSource.query(
				`CREATE TABLE IF NOT EXISTS ${table} (${columns
					.map(([column, spec]) => columnSql(column, spec, false))
					.join(", ")}, PRIMARY KEY (${primary.join(", ")}))`,
			);
		} else {
			const present = new Set((existing as Array<{ column_name: string }>).map((row) => row.column_name));
			for (const [column, spec] of columns) {
				if (!present.has(column)) {
					await this.dataSource.query(`ALTER TABLE ${table} ADD COLUMN ${columnSql(column, spec, true)}`);
				}
			}
		}
		for (const index of definition.indexes ?? []) {
			if (!index.columns.every((column) => Object.hasOwn(definition.columns, column))) invalid();
			const indexName = `ix_${createHash("sha256")
				.update(`${pluginId}:${name}:${index.columns.join(",")}:${index.unique ? "u" : ""}`)
				.digest("hex")
				.slice(0, 40)}`;
			await this.dataSource.query(
				`CREATE ${index.unique ? "UNIQUE " : ""}INDEX IF NOT EXISTS ${quote(indexName)} ON ${table} (${index.columns.map(quote).join(", ")})`,
			);
		}
	}

	async execute(installation: PluginInstallation, call: Record<string, unknown>): Promise<Record<string, unknown>> {
		try {
			await this.ensure(installation);
			const definition = this.tableOf(installation, call.table);
			const table = quote(pluginTableName(installation.pluginId, call.table as string));
			switch (call.op) {
				case "db.find":
					return { rows: await this.find(table, definition, call) };
				case "db.count":
					return await this.count(table, definition, call);
				case "db.insert":
					return { inserted: await this.insert(table, definition, call) };
				case "db.update":
					return { updated: await this.update(table, definition, call) };
				case "db.delete":
					return { deleted: await this.remove(table, definition, call) };
				default:
					return invalid();
			}
		} catch (error: unknown) {
			if (error instanceof PluginDatabaseError) throw error;
			throw new PluginDatabaseError("request_failed");
		}
	}

	private tableOf(installation: PluginInstallation, name: unknown): PluginTableDefinition {
		const definition =
			typeof name === "string" && Object.hasOwn(installation.manifest.database?.tables ?? {}, name)
				? installation.manifest.database?.tables[name]
				: undefined;
		if (!definition) throw new PluginDatabaseError("not_found");
		return definition;
	}

	private column(definition: PluginTableDefinition, name: unknown): [string, PluginColumnDefinition] {
		if (typeof name !== "string" || !Object.hasOwn(definition.columns, name)) invalid();
		return [name, definition.columns[name]!];
	}

	/** Checks a JSON value against the column's type and returns the bound parameter plus the cast it needs. */
	private bind(column: PluginColumnDefinition, value: unknown, allowNull: boolean): { param: unknown; cast: string } {
		const cast = `::${SQL_TYPE[column.type]}`;
		if (value === null) {
			if (!allowNull) invalid();
			return { param: null, cast };
		}
		switch (column.type) {
			case "text":
				if (typeof value !== "string" || Buffer.byteLength(value) > MAX_TEXT_BYTES) invalid();
				return { param: value, cast };
			case "integer":
				if (typeof value !== "number" || !Number.isInteger(value) || Math.abs(value) > 2_147_483_647) invalid();
				return { param: value, cast };
			case "boolean":
				if (typeof value !== "boolean") invalid();
				return { param: value, cast };
			case "uuid":
				if (typeof value !== "string" || !UUID.test(value)) invalid();
				return { param: value.toLowerCase(), cast };
			case "timestamp":
				if (typeof value !== "string" || Number.isNaN(Date.parse(value))) invalid();
				return { param: value, cast };
			case "json": {
				const encoded = JSON.stringify(value);
				if (encoded === undefined || Buffer.byteLength(encoded) > MAX_TEXT_BYTES) invalid();
				return { param: encoded, cast };
			}
		}
	}

	private parseWhere(raw: unknown): WhereClause {
		if (raw === undefined) return { all: [], any: [] };
		if (Array.isArray(raw)) return { all: this.conditions(raw), any: [] };
		if (!isRecord(raw)) invalid();
		const any = raw.any === undefined ? [] : raw.any;
		if (!Array.isArray(any) || any.length > 8) invalid();
		return {
			all: raw.all === undefined ? [] : this.conditions(raw.all),
			any: any.map((group) => this.conditions(group)),
		};
	}

	private conditions(raw: unknown): Condition[] {
		if (!Array.isArray(raw) || raw.length > MAX_CONDITIONS) invalid();
		return raw.map((entry) => {
			if (!isRecord(entry) || typeof entry.col !== "string" || typeof entry.cmp !== "string") invalid();
			return { col: entry.col, cmp: entry.cmp, value: entry.value };
		});
	}

	private conditionSql(definition: PluginTableDefinition, condition: Condition, params: unknown[]): string {
		const [name, column] = this.column(definition, condition.col);
		const identifier = quote(name);
		if (condition.cmp === "isnull") return `${identifier} IS NULL`;
		if (condition.cmp === "notnull") return `${identifier} IS NOT NULL`;
		if (column.type === "json") invalid();
		if (condition.cmp === "in") {
			if (!Array.isArray(condition.value) || condition.value.length === 0 || condition.value.length > MAX_IN_VALUES) {
				invalid();
			}
			const bound = condition.value.map((value) => this.bind(column, value, false).param);
			params.push(bound);
			return `${identifier} = ANY($${params.length}::${SQL_TYPE[column.type]}[])`;
		}
		const operator = COMPARISONS[condition.cmp];
		if (!operator) invalid();
		if ((condition.cmp === "like" || condition.cmp === "ilike") && column.type !== "text") invalid();
		if (condition.value === null) {
			if (condition.cmp === "eq") return `${identifier} IS NULL`;
			if (condition.cmp === "ne") return `${identifier} IS NOT NULL`;
			invalid();
		}
		const { param, cast } = this.bind(column, condition.value, false);
		params.push(param);
		return `${identifier} ${operator} $${params.length}${cast}`;
	}

	private whereSql(definition: PluginTableDefinition, raw: unknown, params: unknown[], required: boolean): string {
		const where = this.parseWhere(raw);
		const parts = where.all.map((condition) => this.conditionSql(definition, condition, params));
		if (where.any.length > 0) {
			const groups = where.any.map((group) => {
				if (group.length === 0) invalid();
				return `(${group.map((condition) => this.conditionSql(definition, condition, params)).join(" AND ")})`;
			});
			parts.push(`(${groups.join(" OR ")})`);
		}
		if (required && parts.length === 0) invalid();
		return parts.length === 0 ? "" : ` WHERE ${parts.join(" AND ")}`;
	}

	private async find(table: string, definition: PluginTableDefinition, call: Record<string, unknown>) {
		const params: unknown[] = [];
		const where = this.whereSql(definition, call.where, params, false);
		const orderBy = this.orderSql(definition, call.orderBy);
		const limit = this.bounded(call.limit, DEFAULT_ROWS, 1, MAX_ROWS);
		const offset = this.bounded(call.offset, 0, 0, 1_000_000);
		const rows: Array<Record<string, unknown>> = await this.dataSource.query(
			`SELECT * FROM ${table}${where}${orderBy} LIMIT ${limit} OFFSET ${offset}`,
			params,
		);
		return rows.map((row) => this.outRow(definition, row));
	}

	private async count(table: string, definition: PluginTableDefinition, call: Record<string, unknown>) {
		const params: unknown[] = [];
		const where = this.whereSql(definition, call.where, params, false);
		if (call.groupBy === undefined) {
			const rows = await this.dataSource.query(`SELECT count(*)::int AS count FROM ${table}${where}`, params);
			return { count: Number(rows[0]?.count ?? 0) };
		}
		const [name, column] = this.column(definition, call.groupBy);
		const rows: Array<{ value: unknown; count: number }> = await this.dataSource.query(
			`SELECT ${quote(name)} AS value, count(*)::int AS count FROM ${table}${where} GROUP BY ${quote(name)} ORDER BY ${quote(name)} LIMIT ${MAX_ROWS}`,
			params,
		);
		return { groups: rows.map((row) => ({ value: this.outValue(column, row.value), count: Number(row.count) })) };
	}

	private async insert(table: string, definition: PluginTableDefinition, call: Record<string, unknown>) {
		const rows = call.rows;
		if (!Array.isArray(rows) || rows.length === 0 || rows.length > MAX_INSERT_ROWS) invalid();
		const columns = Object.keys(definition.columns);
		const params: unknown[] = [];
		const values = rows.map((row) => {
			if (!isRecord(row)) invalid();
			for (const key of Object.keys(row)) this.column(definition, key);
			const cells = columns.map((name) => {
				const column = definition.columns[name]!;
				const value = row[name];
				if (value === undefined) return "DEFAULT";
				const { param, cast } = this.bind(column, value, column.nullable !== false && !column.primary);
				params.push(param);
				return `$${params.length}${cast}`;
			});
			return `(${cells.join(", ")})`;
		});
		const rowsInserted = await this.dataSource.query(
			`WITH written AS (INSERT INTO ${table} (${columns.map(quote).join(", ")}) VALUES ${values.join(", ")} RETURNING 1) SELECT count(*)::int AS count FROM written`,
			params,
		);
		return Number(rowsInserted[0]?.count ?? 0);
	}

	private async update(table: string, definition: PluginTableDefinition, call: Record<string, unknown>) {
		if (!isRecord(call.set) || Object.keys(call.set).length === 0) invalid();
		const params: unknown[] = [];
		const assignments = Object.entries(call.set).map(([name, value]) => {
			const [column, spec] = this.column(definition, name);
			const { param, cast } = this.bind(spec, value, spec.nullable !== false && !spec.primary);
			params.push(param);
			return `${quote(column)} = $${params.length}${cast}`;
		});
		const where = this.whereSql(definition, call.where, params, true);
		const rows = await this.dataSource.query(
			`WITH written AS (UPDATE ${table} SET ${assignments.join(", ")}${where} RETURNING 1) SELECT count(*)::int AS count FROM written`,
			params,
		);
		return Number(rows[0]?.count ?? 0);
	}

	private async remove(table: string, definition: PluginTableDefinition, call: Record<string, unknown>) {
		const params: unknown[] = [];
		const where = this.whereSql(definition, call.where, params, true);
		const rows = await this.dataSource.query(
			`WITH removed AS (DELETE FROM ${table}${where} RETURNING 1) SELECT count(*)::int AS count FROM removed`,
			params,
		);
		return Number(rows[0]?.count ?? 0);
	}

	private orderSql(definition: PluginTableDefinition, raw: unknown): string {
		if (raw === undefined) return "";
		if (!Array.isArray(raw) || raw.length === 0 || raw.length > 4) invalid();
		const parts = raw.map((entry) => {
			if (!isRecord(entry)) invalid();
			const [name] = this.column(definition, entry.col);
			if (entry.dir !== undefined && entry.dir !== "asc" && entry.dir !== "desc") invalid();
			return `${quote(name)} ${entry.dir === "desc" ? "DESC" : "ASC"}`;
		});
		return ` ORDER BY ${parts.join(", ")}`;
	}

	private bounded(value: unknown, fallback: number, min: number, max: number): number {
		if (value === undefined) return fallback;
		if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) invalid();
		return value;
	}

	private outRow(definition: PluginTableDefinition, row: Record<string, unknown>) {
		return Object.fromEntries(
			Object.entries(definition.columns).map(([name, column]) => [name, this.outValue(column, row[name])]),
		);
	}

	private outValue(column: PluginColumnDefinition, value: unknown): unknown {
		if (value === null || value === undefined) return null;
		return column.type === "timestamp" && value instanceof Date ? value.toISOString() : value;
	}
}
