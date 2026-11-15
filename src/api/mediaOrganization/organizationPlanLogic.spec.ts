import { describe, expect, it } from "vitest";
import { DEFAULT_ORGANIZATION_TEMPLATES, rejectTargetCollisions, renderOrganizationTemplate, validateOrganizationTemplates } from "./organizationPlanLogic.js";

describe("media organization plan logic", () => {
	it("accepts defaults and renders safe relative paths", () => {
		const templates = validateOrganizationTemplates(DEFAULT_ORGANIZATION_TEMPLATES);
		expect(renderOrganizationTemplate(templates.movie, { title: "A/B: Film", year: 2024, filename: "film.mkv" })).toBe("A_B_ Film (2024)/film.mkv");
	});

	it("rejects traversal, unsupported placeholders, and missing file names", () => {
		for (const movie of ["../{filename}", "{title}", "{title}/{unknown}/{filename}"]) {
			expect(() => validateOrganizationTemplates({ ...DEFAULT_ORGANIZATION_TEMPLATES, movie })).toThrow();
		}
		expect(() => validateOrganizationTemplates({ ...DEFAULT_ORGANIZATION_TEMPLATES, music: "{artist}/{album}" })).toThrow();
	});

	it("rejects duplicate destinations case-insensitively", () => {
		expect(() => rejectTargetCollisions(["Movies/Film.mkv", "movies/film.mkv"])).toThrow();
		expect(() => rejectTargetCollisions(["Movies/One.mkv", "Movies/Two.mkv"])).not.toThrow();
	});
});
