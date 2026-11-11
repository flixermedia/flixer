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
		const policy = { userId: "user-id" };
		const access = { resolve: vi.fn().mockResolvedValue(policy) };
		const cache = { forHome: vi.fn().mockResolvedValue({ items: [{ id: "album-id", score: 0.9 }] }) };
		const controller = new RecommendationsController(authService as never, recommendations as never, home as never, access as never, cache as never);

		await expect(controller.musicRecommendations("Bearer token")).resolves.toEqual({
			enabled: true,
			items: [{ id: "album-id", type: "album", title: "Album", score: 0.9 }],
		});
		expect(recommendations.recommend).toHaveBeenCalledWith("user-id", {
			limit: 20,
			filters: { types: ["album"] },
		});
		expect(access.resolve).toHaveBeenCalledOnce();
		expect(home.cardsByIds).toHaveBeenCalledWith(["album-id"], policy);
		expect(cache.forHome).toHaveBeenCalledWith("user-id", "music", ["album"]);
	});

	it("returns an empty result without waiting for generation and deduplicates refreshes", async () => {
		const policy = { userId: "user-id" };
		const recommendations = { configuration: vi.fn().mockResolvedValue({ enabled: true }), refresh: vi.fn(() => new Promise(() => {})) };
		const home = { cardsByIds: vi.fn().mockResolvedValue([]) };
		const access = { resolve: vi.fn().mockResolvedValue(policy) };
		const cache = { forHome: vi.fn().mockResolvedValue(null) };
		const controller = new RecommendationsController({} as never, recommendations as never, home as never, access as never, cache as never);

		await expect(controller.homeRecommendations()).resolves.toEqual({ enabled: true, items: [] });
		await expect(controller.homeRecommendations()).resolves.toEqual({ enabled: true, items: [] });
		expect(recommendations.refresh).toHaveBeenCalledOnce();
	});

	it("returns saved results even when AI refresh is still pending", async () => {
		const policy = { userId: "user-id" };
		const recommendations = { configuration: vi.fn().mockResolvedValue({ enabled: true }), recommend: vi.fn(() => new Promise(() => {})) };
		const home = { cardsByIds: vi.fn().mockResolvedValue([{ id: "movie-id", type: "movie", title: "Movie" }]) };
		const access = { resolve: vi.fn().mockResolvedValue(policy) };
		const cache = { forHome: vi.fn().mockResolvedValue({ items: [{ id: "movie-id", score: 0.8 }] }) };
		const controller = new RecommendationsController({} as never, recommendations as never, home as never, access as never, cache as never);

		await expect(controller.homeRecommendations()).resolves.toEqual({ enabled: true, items: [{ id: "movie-id", type: "movie", title: "Movie", score: 0.8 }] });
		expect(recommendations.recommend).toHaveBeenCalledOnce();
	});
});
