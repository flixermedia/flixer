import { describe, expect, it, vi } from "vitest";
import { ActivityService } from "./activityService.js";

function setup() {
	const query = vi.fn(async (sql: string) => {
		if (sql.includes("COUNT(*)")) {
			return [{ total: 7, finished: 3, users: 2 }];
		}
		return [];
	});
	return { query, service: new ActivityService({ query } as never) };
}

const listCall = (query: ReturnType<typeof setup>["query"]) => query.mock.calls.find(([sql]) => String(sql).includes("ORDER BY w.updated_at") || String(sql).includes("ORDER BY user_name") || String(sql).includes("ORDER BY i.title"))!;

describe("ActivityService.list", () => {
	it("defaults to newest first, 25 per page, with a summary", async () => {
		const { query, service } = setup();
		const result = await service.list({});
		const [sql, params] = listCall(query);
		expect(sql).toContain("ORDER BY w.updated_at DESC");
		expect(params).toEqual([25, 0]);
		expect(result.summary).toEqual({ total: 7, finished: 3, inProgress: 4, users: 2 });
	});

	it("binds filters as parameters and never interpolates them", async () => {
		const { query, service } = setup();
		await service.list({ search: "100%_x", type: "movie", status: "finished", from: "2026-01-01", to: "2026-01-31", sort: "title", page: "3", pageSize: "10" });
		const [sql, params] = listCall(query);
		expect(sql).not.toContain("100%");
		expect(sql).toContain("w.completed = true");
		expect(sql).toContain("ORDER BY i.title ASC");
		expect(params).toEqual(["%100\\%\\_x%", "movie", "2026-01-01", "2026-01-31", 10, 20]);
	});

	it("caps the page size", async () => {
		const { query, service } = setup();
		await service.list({ pageSize: "5000" });
		expect(listCall(query)[1]).toEqual([100, 0]);
	});

	it("rejects invalid values", async () => {
		const { service } = setup();
		await expect(service.list({ type: "podcast" })).rejects.toThrow();
		await expect(service.list({ status: "x" })).rejects.toThrow();
		await expect(service.list({ sort: "id; DROP TABLE users" })).rejects.toThrow();
		await expect(service.list({ from: "yesterday" })).rejects.toThrow();
		await expect(service.list({ user: "not-a-uuid" })).rejects.toThrow();
	});
});
