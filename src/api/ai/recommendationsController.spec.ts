import { describe, expect, it, vi } from "vitest";
import { RecommendationsController } from "./recommendationsController.js";

describe("RecommendationsController", () => {
	it("returns personalized album cards for music home recommendations", async () => {
		const authService = { getAuthenticatedUser: vi.fn().mockResolvedValue({ id: "user-id" }) };
		const recommendations = {
			configuration: vi.fn().mockResolvedValue({ enabled: true }),
			recommend: vi.fn().mockResolvedValue({ items: [{ id: "album-id", score: 0.9 }] }),
		};
		const home = {
			cardsByIds: vi.fn().mockResolvedValue([{ id: "album-id", type: "album", title: "Album" }]),
		};
		const controller = new RecommendationsController(authService as never, recommendations as never, home as never);

		await expect(controller.musicRecommendations("Bearer token")).resolves.toEqual({
			enabled: true,
			items: [{ id: "album-id", type: "album", title: "Album", score: 0.9 }],
		});
		expect(recommendations.recommend).toHaveBeenCalledWith("user-id", {
			limit: 20,
			filters: { types: ["album"] },
		});
		expect(home.cardsByIds).toHaveBeenCalledWith(["album-id"]);
	});
});
