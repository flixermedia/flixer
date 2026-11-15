import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { AutomaticCollectionsService } from "./automaticCollectionsService.js";

describe("automatic collections", () => {
	it("groups collection metadata only after applying the viewer's content restrictions", async () => {
		const query = {
			where: vi.fn().mockReturnThis(), andWhere: vi.fn().mockReturnThis(), select: vi.fn().mockReturnThis(),
			addSelect: vi.fn().mockReturnThis(), groupBy: vi.fn().mockReturnThis(), having: vi.fn().mockReturnThis(), orderBy: vi.fn().mockReturnThis(),
			getRawMany: vi.fn().mockResolvedValue([{ collectionKey: "example collection", name: "Example Collection", itemCount: 2, coverIds: [] }]),
		};
		const source = { getRepository: vi.fn(() => ({ createQueryBuilder: () => query })) };
		const access = { restrict: vi.fn() };
		const policy = { userId: "user" };
		const service = new AutomaticCollectionsService(source as never, access as never);
		await expect(service.list(policy as never)).resolves.toEqual([{
			id: createHash("sha256").update("example collection").digest("hex"),
			name: "Example Collection", itemCount: 2, cover: null,
		}]);
		expect(access.restrict).toHaveBeenCalledWith(query, "item", policy, { content: true });
		expect(query.andWhere).toHaveBeenCalledWith("jsonb_typeof(item.metadata -> 'collection') = 'string'");
		expect(query.having).toHaveBeenCalledWith("count(*) > 1");
	});

	it("rejects malformed or invisible collection IDs", async () => {
		const query = {
			where: vi.fn().mockReturnThis(), andWhere: vi.fn().mockReturnThis(), select: vi.fn().mockReturnThis(),
			addSelect: vi.fn().mockReturnThis(), orderBy: vi.fn().mockReturnThis(), addOrderBy: vi.fn().mockReturnThis(),
			getRawMany: vi.fn().mockResolvedValue([]),
		};
		const service = new AutomaticCollectionsService({ getRepository: () => ({ createQueryBuilder: () => query }) } as never, { restrict: vi.fn() } as never);
		await expect(service.get({} as never, "bad-id")).rejects.toThrow("Collection not found");
		await expect(service.get({} as never, "a".repeat(64))).rejects.toThrow("Collection not found");
		query.getRawMany.mockResolvedValueOnce([{ id: "only-item", name: "Single" }]);
		await expect(service.get({} as never, "b".repeat(64))).rejects.toThrow("Collection not found");
	});
});