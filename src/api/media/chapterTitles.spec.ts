import { describe, expect, it } from "vitest";
import { normalizeChapterField, normalizeChapterTitle, normalizeChapterTitles } from "./chapterTitles.js";

describe("chapter title normalization", () => {
	it("numbers timestamp titles by chronological position without changing names or array order", () => {
		const input = [
			{ title: "00:04:53.126", start: 293.126, end: 500 },
			{ title: "Opening", start: 0, end: 100 },
			{ title: " 01:00:00 ", start: 3600, end: 4000 },
			{ title: "00:90:00", start: 5000, end: 5100 },
			{ title: "At 00:01:00", start: 5100, end: 5200 },
		];
		expect(normalizeChapterTitles(input)).toEqual([
			{ title: "Chapter 2", start: 293.126, end: 500 },
			input[1],
			{ title: "Chapter 3", start: 3600, end: 4000 },
			input[3],
			input[4],
		]);
		expect(input[0]?.title).toBe("00:04:53.126");
		expect(normalizeChapterTitle("00:00:00.000", 1)).toBe("Chapter 1");
	});

	it("preserves malformed entries and non-array chapter fields", () => {
		expect(normalizeChapterTitles([null, "chapter", { title: "00:00:01", start: 0 }])).toEqual([null, "chapter", { title: "Chapter 1", start: 0 }]);
		expect(normalizeChapterField({ chapters: null }, "chapters")).toEqual({ chapters: null });
	});
});
