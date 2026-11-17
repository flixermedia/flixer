import { describe, expect, it } from "vitest";
import { sanitizeSearchSections } from "./pluginSearchService.js";

describe("sanitizeSearchSections", () => {
	it("keeps well-formed items and drops unsafe or malformed data", () => {
		const sections = sanitizeSearchSections("flixer.requests", {
			sections: [
				{
					title: "Not in library",
					items: [
						{
							title: "Dune",
							poster: "https://image.tmdb.org/p.jpg",
							badge: { text: "Pending", tone: "warning" },
							page: "requests",
							query: { view: "item", id: "1", nested: { a: 1 } },
						},
						{ title: "Bad", poster: "javascript:alert(1)", page: "Not Valid", query: {} },
						{ title: "Insecure", poster: "http://x.example/p.jpg", page: "requests", query: {} },
					],
				},
				{ title: "Empty", items: [] },
			],
		});
		expect(sections).toHaveLength(1);
		expect(sections[0]!.items).toHaveLength(2);
		expect(sections[0]!.items[0]).toMatchObject({ shape: "poster", badge: { tone: "warning" }, query: { view: "item", id: "1" } });
		expect(sections[0]!.items[1]!.poster).toBeUndefined();
	});

	it("returns nothing for invalid results", () => {
		expect(sanitizeSearchSections("p", null)).toEqual([]);
		expect(sanitizeSearchSections("p", { sections: "x" })).toEqual([]);
	});
});
