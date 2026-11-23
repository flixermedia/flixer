import { DataSource } from "typeorm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AiDataService } from "./aiDataService.js";

describe("AiDataService", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("maps provider genre and studio objects to recommendation text fields", async () => {
		const rows = [
			{
				id: "media-id",
				type: "movie",
				title: "Example",
				year: 2024,
				overview: "A synopsis",
				tagline: null,
				genres: [{ name: "Science Fiction" }, "Adventure"],
				studios: [{ name: "Example Studio" }],
				cast: [{ name: "Example Actor" }],
				crew: [],
				artist: null,
			},
		];
		const builder = { select: vi.fn(), addSelect: vi.fn(), where: vi.fn(), andWhere: vi.fn(), orderBy: vi.fn(), take: vi.fn(), getRawMany: vi.fn().mockResolvedValue(rows) };
		for (const name of ["select", "addSelect", "where", "andWhere", "orderBy", "take"] as const) builder[name].mockReturnValue(builder);
		const dataSource = { getRepository: vi.fn(() => ({ createQueryBuilder: vi.fn(() => builder) })) } as unknown as DataSource;

		const result = await new AiDataService(dataSource).libraryContext();

		expect(result.candidates[0]).toMatchObject({
			id: "media-id",
			genres: ["Science Fiction", "Adventure"],
			studios: ["Example Studio"],
		});
		expect(builder.take).toHaveBeenCalledWith(20_000);
	});
});
