import { describe, expect, it, vi } from "vitest";
import type { DataSource } from "typeorm";
import type { PluginInstallation } from "../../entities/pluginInstallation.entity.js";
import { PluginDatabaseError, PluginDatabaseService, pluginTableName } from "./pluginDatabaseService.js";
import { executeHostCalls } from "./pluginHostCalls.js";

const installation = {
	pluginId: "flixer.requests",
	packageDigest: "sha256:abc",
	manifest: {
		database: {
			tables: {
				items: {
					columns: {
						id: { type: "uuid", primary: true },
						title: { type: "text" },
						n: { type: "integer", nullable: false, default: 0 },
						meta: { type: "json" },
					},
					indexes: [{ columns: ["title"] }],
				},
			},
		},
	},
} as unknown as PluginInstallation;

function setup(rows: unknown[] = []) {
	const query = vi.fn(async (sql: string) => (sql.includes("information_schema") ? [] : rows));
	return { query, service: new PluginDatabaseService({ query } as unknown as DataSource) };
}

describe("PluginDatabaseService", () => {
	it("provisions hashed tables once and binds every value as a parameter", async () => {
		const { query, service } = setup([{ count: 2 }]);
		const table = pluginTableName("flixer.requests", "items");
		const result = await service.execute(installation, {
			op: "db.update",
			table: "items",
			set: { title: "x'; DROP TABLE users;--" },
			where: [{ col: "n", cmp: "in", value: [1, 2] }],
		});
		expect(result).toEqual({ updated: 2 });
		const create = query.mock.calls.find(([sql]) => String(sql).includes("CREATE TABLE"))!;
		expect(String(create[0])).toContain(`"${table}"`);
		const update = query.mock.calls.find(([sql]) => String(sql).includes("UPDATE"))!;
		expect(String(update[0])).not.toContain("DROP");
		expect(update[1]).toEqual(["x'; DROP TABLE users;--", [1, 2]]);

		await service.execute(installation, { op: "db.count", table: "items" });
		expect(query.mock.calls.filter(([sql]) => String(sql).includes("CREATE TABLE"))).toHaveLength(1);
	});

	it.each([
		{ op: "db.find", table: "users" },
		{ op: "db.find", table: "items", where: [{ col: "nope", cmp: "eq", value: 1 }] },
		{ op: "db.find", table: "items", where: [{ col: "n", cmp: "eq", value: "1" }] },
		{ op: "db.delete", table: "items" },
		{ op: "db.update", table: "items", set: { n: 1 } },
		{ op: "db.find", table: "items", limit: 1000 },
	])("rejects %j", async (call) => {
		const { service } = setup();
		await expect(service.execute(installation, call)).rejects.toBeInstanceOf(PluginDatabaseError);
	});
});

describe("http.request host calls", () => {
	const call = { id: "a", op: "http.request", url: "https://sonarr.example.org/api", method: "PUT", body: "{}" };

	it("needs a host or any-host permission and filters headers", async () => {
		const http = vi.fn(async () => ({ status: 200, body: "ok" }));
		expect((await executeHostCalls([call], new Set(), http))[0]).toMatchObject({ error: "permission_denied" });
		const results = await executeHostCalls(
			[{ ...call, headers: { "X-Api-Key": "k" } }],
			new Set(["network.http.any"]),
			http,
		);
		expect(results[0]).toMatchObject({ ok: true });
		expect(http).toHaveBeenCalledWith(expect.any(URL), { method: "PUT", headers: { "x-api-key": "k" }, body: "{}" });
		expect(
			(await executeHostCalls([{ ...call, headers: { cookie: "x" } }], new Set(["network.http.any"]), http))[0],
		).toMatchObject({ error: "invalid_url" });
	});
});
