import { describe, expect, it } from "vitest";
import { isNewer, parseVersion } from "./updateService.js";

describe("update versions", () => {
	it("parses stable versions only", () => {
		expect(parseVersion("v1.2.3")).toEqual([1, 2, 3]);
		expect(parseVersion("0.10.0")).toEqual([0, 10, 0]);
		expect(parseVersion("dev")).toBeNull();
		expect(parseVersion("1.2.3-beta")).toBeNull();
		expect(parseVersion(null)).toBeNull();
	});

	it("compares numerically, not as text", () => {
		expect(isNewer("0.10.0", "0.9.5")).toBe(true);
		expect(isNewer("1.0.0", "0.99.99")).toBe(true);
		expect(isNewer("1.2.3", "1.2.3")).toBe(false);
		expect(isNewer("1.2.2", "1.2.3")).toBe(false);
	});

	it("never treats development builds or missing versions as outdated", () => {
		expect(isNewer("9.9.9", "dev")).toBe(false);
		expect(isNewer(null, "1.0.0")).toBe(false);
		expect(isNewer("1.0.0", undefined)).toBe(false);
	});
});
