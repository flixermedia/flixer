import { describe, expect, it } from "vitest";
import { chapterSegments, mergeSegments, parseChapters, pickSkipmeTimestamp } from "./segmentLogic.js";

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

	it("keeps one segment per type, preferring manual over skipme over chapters", () => {
		const merged = mergeSegments([
			{ type: "intro", startMs: 0, endMs: 1000, source: "chapter" },
			{ type: "intro", startMs: 100, endMs: 900, source: "skipme" },
			{ type: "intro", startMs: 200, endMs: 800, source: "manual" },
			{ type: "credits", startMs: 5000, endMs: 6000, source: "chapter" },
		]);
		expect(merged).toEqual([
			{ type: "intro", startMs: 200, endMs: 800, source: "manual" },
			{ type: "credits", startMs: 5000, endMs: 6000, source: "chapter" },
		]);
	});

	it("picks the crowd-sourced entry that matches the file length with the most submissions", () => {
		const entries = [
			{ start_ms: 1000, end_ms: 2000, duration_ms: 1_400_000, submissions: 9 },
			{ start_ms: 3000, end_ms: 4000, duration_ms: 1_320_000, submissions: 2 },
			{ start_ms: 5000, end_ms: 4000, duration_ms: 1_320_000, submissions: 50 },
			{ start_ms: 7000, end_ms: 8000, duration_ms: 1_321_000, submissions: 5 },
		];
		expect(pickSkipmeTimestamp(entries, 1_320_500)).toEqual({ startMs: 7000, endMs: 8000, submissions: 5 });
		expect(pickSkipmeTimestamp(entries, 60_000)).toBeNull();
		expect(pickSkipmeTimestamp(undefined, 1000)).toBeNull();
	});
});
