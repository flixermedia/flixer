import { describe, expect, it } from "vitest";
import { pickNextEpisode, type EpisodeRef } from "./nextEpisode.js";

const ep = (id: string, seasonNumber: number | null, episodeNumber: number | null): EpisodeRef => ({ id, title: id, seasonNumber, episodeNumber });
const all = [ep("s2e1", 2, 1), ep("s1e2", 1, 2), ep("s1e1", 1, 1), ep("sp", 0, 1)];

describe("pickNextEpisode", () => {
	it("plays the next episode of the season", () => {
		expect(pickNextEpisode("s1e1", all)?.id).toBe("s1e2");
	});
	it("rolls over into the next season", () => {
		expect(pickNextEpisode("s1e2", all)?.id).toBe("s2e1");
	});
	it("has nothing after the final episode", () => {
		expect(pickNextEpisode("s2e1", all)).toBeNull();
	});
	it("does not roll from specials into the show", () => {
		expect(pickNextEpisode("sp", all)).toBeNull();
	});
	it("returns null for an unknown episode", () => {
		expect(pickNextEpisode("nope", all)).toBeNull();
	});
});
