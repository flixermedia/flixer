import { describe, expect, it } from "vitest";
import { isDashboardGrid } from "./preferencesService.js";

describe("dashboard grid preference", () => {
	it("accepts placed panels, including none", () => {
		expect(isDashboardGrid([])).toBe(true);
		expect(
			isDashboardGrid([
				{ id: "server", x: 0, y: 0, w: 2, h: 6 },
				{ id: "live-streams", x: 2, y: 4, w: 3, h: 2 },
			]),
		).toBe(true);
	});

	it("rejects panels outside the grid or with unsupported sizes", () => {
		expect(isDashboardGrid([{ id: "stats", x: 3, y: 0, w: 3, h: 2 }])).toBe(false);
		expect(isDashboardGrid([{ id: "stats", x: 0, y: 0, w: 6, h: 2 }])).toBe(false);
		expect(isDashboardGrid([{ id: "stats", x: 0, y: 0, w: 2, h: 7 }])).toBe(false);
		expect(isDashboardGrid([{ id: "stats", x: 0, y: 0, w: 2, h: 0 }])).toBe(false);
		expect(isDashboardGrid([{ id: "stats", x: 0.5, y: 0, w: 2, h: 2 }])).toBe(false);
		expect(isDashboardGrid([{ id: "stats", x: 0, y: -1, w: 2, h: 2 }])).toBe(false);
		expect(isDashboardGrid([{ id: "stats", x: 0, y: 100, w: 2, h: 2 }])).toBe(false);
	});

	it("rejects bad ids, repeats and other shapes", () => {
		expect(isDashboardGrid([{ id: "<script>", x: 0, y: 0, w: 1, h: 1 }])).toBe(false);
		expect(
			isDashboardGrid([
				{ id: "stats", x: 0, y: 0, w: 1, h: 1 },
				{ id: "stats", x: 1, y: 0, w: 1, h: 1 },
			]),
		).toBe(false);
		expect(isDashboardGrid(["stats"])).toBe(false);
		expect(isDashboardGrid(null)).toBe(false);
		expect(isDashboardGrid({})).toBe(false);
		expect(isDashboardGrid(Array.from({ length: 41 }, (_, i) => ({ id: `w${"x".repeat(i % 20)}${String.fromCharCode(97 + (i % 26))}${"y".repeat(Math.floor(i / 20))}`, x: 0, y: 0, w: 1, h: 1 })))).toBe(false);
	});
});
