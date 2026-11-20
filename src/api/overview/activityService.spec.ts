import { describe, expect, it, vi } from "vitest";
import { ActivityService } from "./activityService.js";

function setup() {

	const builder = {
		innerJoin: vi.fn(),
		leftJoin: vi.fn(),
		select: vi.fn(),
		addSelect: vi.fn(),
		where: vi.fn(),
		clone: vi.fn(),
		orderBy: vi.fn(),
		addOrderBy: vi.fn(),
		limit: vi.fn(),
		offset: vi.fn(),
		getRawMany: vi.fn().mockResolvedValue([]),
		getRawOne: vi.fn().mockResolvedValue({ total: 7, finished: 3, users: 2 }),
	};
	for (const name of ["innerJoin", "leftJoin", "select", "addSelect", "where", "clone", "orderBy", "addOrderBy", "limit", "offset"] as const) builder[name].mockReturnValue(builder);
	return { builder, service: new ActivityService({ getRepository: () => ({ createQueryBuilder: () => builder }) } as never) };

}

describe("ActivityService.list", () => {
	it("defaults to newest first, 25 per page, with a summary", async () => {
		const { builder, service } = setup();
		const result = await service.list({});
		expect(builder.orderBy).toHaveBeenCalledWith("w.updatedAt", "DESC");
		expect(builder.limit).toHaveBeenCalledWith(25);
		expect(builder.offset).toHaveBeenCalledWith(0);
		expect(result.summary).toEqual({ total: 7, finished: 3, inProgress: 4, users: 2 });
	});

	it("binds filters as parameters and never interpolates them", async () => {
		const { builder, service } = setup();
		await service.list({ search: "100%_x", type: "movie", status: "finished", from: "2026-01-01", to: "2026-01-31", sort: "title", page: "3", pageSize: "10" });
		const [sql, params] = builder.where.mock.calls[0];
		expect(sql).not.toContain("100%");
		expect(sql).toContain("w.completed = true");
		expect(builder.orderBy).toHaveBeenCalledWith("i.title", "ASC");
		expect(params).toEqual({ filter0: "%100\\%\\_x%", filter1: "movie", filter2: "2026-01-01", filter3: "2026-01-31" });
		expect(builder.limit).toHaveBeenCalledWith(10);
		expect(builder.offset).toHaveBeenCalledWith(20);
	});

	it("caps the page size", async () => {
		const { builder, service } = setup();
		await service.list({ pageSize: "5000" });
		expect(builder.limit).toHaveBeenCalledWith(100);
		expect(builder.offset).toHaveBeenCalledWith(0);
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
