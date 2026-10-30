import { describe, expect, it } from "vitest";
import { chapterSegments, mergeSegments, parseChapters } from "./segmentLogic.js";

describe("segmentLogic", () => {
	it("reads stored chapters in seconds and skips malformed ones", () => {
		const chapters = parseChapters({
			chapters: [
				{ title: "Credits", start: 1300, end: 1400 },
				{ title: "Intro", start: 0, end: 90.5 },
				{ title: "Bad", start: 10, end: 5 },
				"nope",
			],
		});
		expect(chapters).toEqual([
			{ title: "Intro", startMs: 0, endMs: 90500 },
			{ title: "Credits", startMs: 1300000, endMs: 1400000 },
		]);
		expect(parseChapters(null)).toEqual([]);
	});

	it("maps chapter titles onto segment types without matching inside other words", () => {
		const chapters = [
			{ title: "Opening", startMs: 0, endMs: 1000 },
			{ title: "Chapter 2: Shadow", startMs: 1000, endMs: 2000 },
			{ title: "Previously on", startMs: 2000, endMs: 3000 },
			{ title: "Commercial Break", startMs: 3000, endMs: 4000 },
			{ title: "ED", startMs: 4000, endMs: 5000 },
			{ title: "", startMs: 5000, endMs: 6000 },
		];
		expect(chapterSegments(chapters).map((s) => s.type)).toEqual(["intro", "recap", "commercial", "credits"]);
	});

	it("keeps one segment per type, preferring manual over indexed provider data over chapters", () => {
		const merged = mergeSegments([
			{ type: "intro", startMs: 0, endMs: 1000, source: "chapter" },
			{ type: "intro", startMs: 100, endMs: 900, source: "theintrodb" },
			{ type: "intro", startMs: 200, endMs: 800, source: "manual" },
			{ type: "credits", startMs: 3000, endMs: 4000, source: "plugin" },
			{ type: "credits", startMs: 5000, endMs: 6000, source: "chapter" },
		]);
		expect(merged).toEqual([
			{ type: "intro", startMs: 200, endMs: 800, source: "manual" },
			{ type: "credits", startMs: 3000, endMs: 4000, source: "plugin" },
		]);
	});
});
