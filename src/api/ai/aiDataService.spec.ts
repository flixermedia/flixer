import { DataSource } from "typeorm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AiDataService } from "./aiDataService.js";

describe("AiDataService", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("maps provider genre and studio objects to recommendation text fields", async () => {
		const dataSource = new DataSource({ type: "postgres", host: "127.0.0.1", database: "flixer" });
		vi.spyOn(dataSource, "query").mockResolvedValue([
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
		]);

		const result = await new AiDataService(dataSource).libraryContext();

		expect(result.candidates[0]).toMatchObject({
			id: "media-id",
			genres: ["Science Fiction", "Adventure"],
			studios: ["Example Studio"],
		});
	});
});
