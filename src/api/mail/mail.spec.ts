import { describe, expect, it } from "vitest";
import { domainCovers, headerSafe, normalizeDomain, parseAddress } from "./mailAddress.js";
import { sanitizeEmailHtml } from "./mailMessageService.js";
import { fillTemplate, templateVariables } from "./mailTemplateService.js";
import { usernameLocalPart } from "./mailboxService.js";

describe("mail addresses", () => {
	it("normalizes and validates domains and addresses", () => {
		expect(normalizeDomain(" Mail.Example.COM. ")).toBe("mail.example.com");
		expect(normalizeDomain("localhost")).toBeNull();
		expect(normalizeDomain("1.2.3.4")).toBeNull();
		expect(parseAddress("NoReply@Example.com")?.address).toBe("noreply@example.com");
		expect(parseAddress("a b@example.com")).toBeNull();
		expect(parseAddress("a..b@example.com")).toBeNull();
	});

	it("matches wildcard domains only when subdomains are allowed", () => {
		expect(domainCovers("example.com", false, "mail.example.com")).toBe(false);
		expect(domainCovers("example.com", true, "mail.example.com")).toBe(true);
		expect(domainCovers("example.com", true, "notexample.com")).toBe(false);
	});

	it("strips header injection characters", () => {
		expect(headerSafe("Hi\r\nBcc: x@y.z")).toBe("Hi Bcc: x@y.z");
	});
});

describe("mail templates", () => {
	it("finds variables and escapes html values only", () => {
		expect(templateVariables("Hi {{name}} {{name}}", "{{url}}")).toEqual(["name", "url"]);
		const html = fillTemplate("<p>{{name}}</p>", { name: "<b>" }, (value) => value.replace(/</g, "&lt;"));
		expect(html).toBe("<p>&lt;b></p>");
	});
});

describe("sanitizeEmailHtml", () => {
	it("removes scripts, handlers and remote images", () => {
		const clean = sanitizeEmailHtml('<p onclick="x()">Hi</p><script>alert(1)</script><img src="https://tracker.test/p.gif"><a href="javascript:alert(1)">l</a>');
		expect(clean).not.toMatch(/script|onclick|tracker|javascript/i);
		expect(clean).toContain("Hi");
	});
});

describe("usernameLocalPart", () => {
	it("makes a safe local part or null", () => {
		expect(usernameLocalPart("Alex Smith")).toMatch(/^[a-z0-9._+-]+$/);
		expect(usernameLocalPart("!!!")).toBeNull();
	});
});
