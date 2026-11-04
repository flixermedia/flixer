import { describe, expect, it } from "vitest";
import { ratingAgeSql, ratingToAge } from "./contentRatings.js";
import { scheduleAllows, scheduleStatus } from "./mediaAccessService.js";

describe("ratingToAge", () => {
	it.each([
		["G", 0], ["PG", 8], ["PG-13", 13], ["R", 17], ["NC-17", 18], ["TV-MA", 17], ["TV-Y7", 7],
		["us:tv-14", 14], ["TV PG", 10], ["12A", 12], ["FSK 16", 16], ["DE/18", 18], ["16+", 16], ["15", 15],
	])("maps %s to %s", (label, age) => expect(ratingToAge(label)).toBe(age));

	it.each(["", "NR", "Unrated", "Not Rated", "banana", null, undefined])("treats %s as unrated", (label) => expect(ratingToAge(label)).toBeNull());

	it("builds SQL covering every label", () => {
		expect(ratingAgeSql("x")).toContain("WHEN 'PG-13' THEN 13");
	});
});

describe("schedule", () => {
	const weekdays = { timezone: "UTC", windows: [{ days: [1, 2, 3, 4, 5], from: "16:00", to: "20:00" }] };

	it("allows everything without windows", () => expect(scheduleAllows(null, 0, 0)).toBe(true));
	it("allows inside a window and blocks outside it", () => {
		expect(scheduleAllows(weekdays, 1, 17 * 60)).toBe(true);
		expect(scheduleAllows(weekdays, 1, 20 * 60)).toBe(false);
		expect(scheduleAllows(weekdays, 0, 17 * 60)).toBe(false);
	});
	it("handles overnight windows", () => {
		const night = { timezone: "UTC", windows: [{ days: [5], from: "22:00", to: "02:00" }] };
		expect(scheduleAllows(night, 5, 23 * 60)).toBe(true);
		expect(scheduleAllows(night, 6, 60)).toBe(true);
		expect(scheduleAllows(night, 6, 3 * 60)).toBe(false);
	});
	it("reports when viewing next opens", () => {
		const status = scheduleStatus(weekdays, new Date("2026-11-04T10:00:00Z"));
		expect(status).toEqual({ allowed: false, nextAllowedAt: "2026-11-04T16:00:00.000Z" });
		expect(scheduleStatus(weekdays, new Date("2026-11-04T17:00:00Z")).allowed).toBe(true);
	});
});
