import { describe, expect, it } from "vitest";
import { sanitizePageContent, sanitizePageDraft } from "./pageBuilderSchema.js";

const block = (id: string, type: string, text = "") => ({ id, type, text, image: null });

describe("page builder validation", () => {
	it("keeps exactly one built-in sign-in block on login pages", () => {
		expect(sanitizePageContent({ blocks: [block("title", "heading", "Hello"), block("auth", "auth")] }, "login").blocks).toHaveLength(2);
		for (const blocks of [[], [block("auth", "auth"), block("auth2", "auth")]]) expect(() => sanitizePageContent({ blocks }, "login")).toThrow();
		expect(() => sanitizePageContent({ blocks: [block("auth", "auth")] }, "page")).toThrow();
	});

	it("rejects unsafe images, unknown blocks, duplicates and reserved addresses", () => {
		expect(() => sanitizePageContent({ blocks: [{ ...block("image", "image"), image: "https://example.com/image.png" }] }, "page")).toThrow();
		expect(() => sanitizePageContent({ blocks: [block("one", "script")] }, "page")).toThrow();
		expect(() => sanitizePageContent({ blocks: [block("one", "text"), block("one", "text")] }, "page")).toThrow();
		expect(() => sanitizePageDraft({ title: "Page", slug: "login", draft: { blocks: [] } }, "page")).toThrow();
	});

	it("validates links, styling, and nested column blocks", () => {
		const button = { ...block("button", "button", "Open"), href: "https://example.com", style: { align: "center", color: "#112233" } };
		expect(sanitizePageContent({ blocks: [{ ...block("columns", "columns"), columns: [[button], []] }] }, "page").blocks[0].columns?.[0][0]).toMatchObject({ href: "https://example.com/", style: { align: "center" } });
		for (const href of ["javascript:alert(1)", "//evil.example", "data:text/html,test"]) expect(() => sanitizePageContent({ blocks: [{ ...button, href }] }, "page")).toThrow();
		expect(() => sanitizePageContent({ blocks: [{ ...button, style: { color: "red;display:none" } }] }, "page")).toThrow();
		expect(() => sanitizePageContent({ blocks: [{ ...block("columns", "columns"), columns: [[block("auth", "auth")], []] }] }, "login")).toThrow();
	});

	it("accepts individually placed sign-in elements only when all required fields exist", () => {
		const fields = ["username", "password", "email", "submit", "switch"].map((field) => ({ ...block(field, "auth-field"), field }));
		expect(sanitizePageContent({ layout: "free", blocks: fields }, "login").blocks).toHaveLength(5);
		expect(() => sanitizePageContent({ layout: "free", blocks: fields.slice(1) }, "login")).toThrow();
		expect(() => sanitizePageContent({ layout: "free", blocks: [...fields, fields[0]] }, "login")).toThrow();
		expect(() => sanitizePageContent({ blocks: fields }, "page")).toThrow();
	});

	it("accepts only explicitly selected custom metadata on same-origin actions", () => {
		const fields = ["username", "password", "email", "submit", "switch"].map((field) => ({ ...block(field, "auth-field"), field }));
		const custom = block("genre", "auth-custom", "Genre");
		const action = { ...block("action", "auth-action", "Submit"), href: "/api/example", allowedFields: ["genre"] };
		expect(sanitizePageContent({ layout: "free", blocks: [...fields, custom, action] }, "login").blocks.at(-1)).toMatchObject({ href: "/api/example", allowedFields: ["genre"] });
		for (const href of ["https://evil.test", "//evil.test", "/\\evil.test"]) expect(() => sanitizePageContent({ layout: "free", blocks: [...fields, custom, { ...action, href }] }, "login")).toThrow();
		expect(() => sanitizePageContent({ layout: "free", blocks: [...fields, custom, { ...action, allowedFields: ["password"] }] }, "login")).toThrow();
	});

	it("keeps independent responsive positions and rejects out-of-bounds geometry", () => {
		const heading = { ...block("heading", "heading", "Welcome"), position: { desktop: { x: 25, y: 120, width: 50 }, mobile: { x: 5, y: 240, width: 90 } } };
		expect(sanitizePageContent({ layout: "free", blocks: [heading] }, "page")).toMatchObject({ layout: "free", blocks: [{ position: heading.position }] });
		expect(() => sanitizePageContent({ layout: "free", blocks: [{ ...heading, position: { ...heading.position, desktop: { x: 80, y: 0, width: 50 } } }] }, "page")).toThrow();
		expect(() => sanitizePageContent({ layout: "free", blocks: [{ ...heading, position: { ...heading.position, mobile: { x: 0, y: -1, width: 90 } } }] }, "page")).toThrow();
	});
});