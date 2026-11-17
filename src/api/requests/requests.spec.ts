import { describe, expect, it } from "vitest";
import { normalizeArrUrl, pickAlbum } from "./arrClient.js";
import { normalizeTitle, splitDiscogsTitle, yearOf } from "./externalMetadata.js";
import { remainingSeasons, resolveAccess } from "./requestAccess.js";
import { parseRequestSettings, validateRequestSetting } from "./requestSettings.js";

const defaults = parseRequestSettings(new Map());

describe("request settings", () => {
	it("are off by default", () => {
		expect(defaults.enabled).toBe(false);
		expect(defaults.autoApprove).toBe(false);
		expect(defaults.quotaLimit).toBe(0);
	});

	it("rejects invalid values", () => {
		expect(() => validateRequestSetting("requests_enabled", "yes")).toThrow();
		expect(() => validateRequestSetting("requests_quota_limit", -1)).toThrow();
		expect(() => validateRequestSetting("requests_quota_days", 0)).toThrow();
		expect(() => validateRequestSetting("requests_quota_days", 30)).not.toThrow();
	});
});

describe("request access", () => {
	it("gives administrators everything", () => {
		const access = resolveAccess(
			true,
			{ ...defaults, quotaLimit: 2 },
			{ userId: "u", canRequest: false, autoApprove: false, quotaLimit: 1, quotaDays: 1 },
		);
		expect(access).toMatchObject({ canRequest: true, autoApprove: true, quotaLimit: null });
	});

	it("applies per-user overrides over the defaults", () => {
		const settings = { ...defaults, quotaLimit: 5, quotaDays: 7 };
		expect(resolveAccess(false, settings, null)).toMatchObject({
			canRequest: true,
			autoApprove: false,
			quotaLimit: 5,
			quotaDays: 7,
		});
		expect(
			resolveAccess(false, settings, {
				userId: "u",
				canRequest: false,
				autoApprove: true,
				quotaLimit: 0,
				quotaDays: 30,
			}),
		).toMatchObject({ canRequest: false, autoApprove: true, quotaLimit: null, quotaDays: 30 });
	});

	it("removes seasons that were already requested", () => {
		expect(remainingSeasons(null, [[1, 2]], [1, 2, 3])).toEqual([3]);
		expect(remainingSeasons([1, 3], [null], [1, 2, 3])).toEqual([]);
		expect(remainingSeasons([2], [], [1, 2, 3])).toEqual([2]);
	});
});

describe("external metadata helpers", () => {
	it("reads years", () => {
		expect(yearOf("2010-07-16")).toBe(2010);
		expect(yearOf("")).toBeNull();
		expect(yearOf(1999)).toBe(1999);
	});

	it("splits Discogs titles", () => {
		expect(splitDiscogsTitle("Daft Punk - Discovery")).toEqual({ artist: "Daft Punk", title: "Discovery" });
		expect(splitDiscogsTitle("Nirvana (2) - Nevermind")).toEqual({ artist: "Nirvana", title: "Nevermind" });
		expect(splitDiscogsTitle("Untitled")).toEqual({ artist: null, title: "Untitled" });
	});

	it("normalizes titles", () => {
		expect(normalizeTitle("Amélie!")).toBe("amelie");
		expect(normalizeTitle("Spider-Man: Homecoming")).toBe("spidermanhomecoming");
	});
});

describe("arr helpers", () => {
	it("normalizes server URLs", () => {
		expect(normalizeArrUrl(" http://sonarr:8989/ ")).toBe("http://sonarr:8989");
		expect(normalizeArrUrl("ftp://host")).toBeNull();
		expect(normalizeArrUrl("not a url")).toBeNull();
	});

	it("picks the album with the matching title and artist", () => {
		const results = [
			{ title: "Discovery (Live)", artist: { artistName: "Daft Punk" } },
			{ title: "Discovery", artist: { artistName: "Other" } },
			{ title: "Discovery", artist: { artistName: "Daft Punk" } },
		];
		expect(pickAlbum(results, "Discovery", "Daft Punk")).toBe(results[2]);
		expect(pickAlbum(results, "Discovery", "Nobody")).toBe(results[1]);
		expect(pickAlbum([], "x", null)).toBeNull();
	});
});
