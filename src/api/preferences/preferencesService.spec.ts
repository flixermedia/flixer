import { describe, expect, it } from "vitest";
import { compile } from "@tsed/schema";
import { isAutoSkipIntroCredits, isBrowseColumns, isDashboardGrid, publicPreferences } from "./preferencesService.js";
import { UpdatePreferencesRequest } from "./updatePreferencesRequest.js";

describe("user preferences", () => {
	it("accepts placed panels, including none", () => {
		expect(isDashboardGrid([])).toBe(true);
		expect(
			isDashboardGrid([
				{ id: "server", x: 0, y: 0, w: 2, h: 6 },
				{ id: "live-streams", x: 2, y: 4, w: 3, h: 2 },
			]),
		).toBe(true);
	});

	describe("preferences request schema", () => {
		it("accepts a nullable array of dashboard grid items", () => {
			const schema = compile(UpdatePreferencesRequest);
			expect(schema.properties?.adminDashboardGrid).toMatchObject({
				type: ["null", "array"],
				items: { $ref: "#/definitions/DashboardGridItemRequest" },
			});
		});

		it("accepts a nullable integer browse column count", () => {
			const schema = compile(UpdatePreferencesRequest);
			expect(schema.properties?.browseColumns).toMatchObject({
				type: ["null", "integer"],
				minimum: 2,
				maximum: 8,
			});
		});

		it("accepts a nullable boolean auto-skip preference", () => {
			const schema = compile(UpdatePreferencesRequest);
			expect(schema.properties?.autoSkipIntroCredits).toMatchObject({
				type: ["null", "boolean"],
			});
		});
	});

	it("accepts browse column counts from 2 through 8", () => {
		expect(isBrowseColumns(2)).toBe(true);
		expect(isBrowseColumns(8)).toBe(true);
		expect(isBrowseColumns(1)).toBe(false);
		expect(isBrowseColumns(9)).toBe(false);
		expect(isBrowseColumns(3.5)).toBe(false);
		expect(isBrowseColumns("4")).toBe(false);
	});

	it("accepts boolean auto-skip values", () => {
		expect(isAutoSkipIntroCredits(true)).toBe(true);
		expect(isAutoSkipIntroCredits(false)).toBe(true);
		expect(isAutoSkipIntroCredits(null)).toBe(false);
		expect(isAutoSkipIntroCredits("true")).toBe(false);
	});

	it("defaults automatic intro and credits skipping on while honoring saved values", () => {
		expect(publicPreferences({}).autoSkipIntroCredits).toBe(true);
		expect(publicPreferences({ autoSkipIntroCredits: false }).autoSkipIntroCredits).toBe(false);
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
