import { describe, expect, it } from "vitest";
import { validateOidcRedirectUris } from "./oidcClientService.js";

describe("validateOidcRedirectUris", () => {
	it("allows exact HTTPS and HTTP loopback redirects", () => {
		expect(() => validateOidcRedirectUris(["https://app.example/callback?x=1", "http://localhost:8080/callback", "http://127.0.0.1:3000/callback"])).not.toThrow();
	});

	it.each([
		[],
		["http://example.com/callback"],
		["https://example.com/callback#fragment"],
		["https://user:pass@example.com/callback"],
		["javascript:alert(1)"],
		["https://example.com/callback", "https://example.com/callback"],
	])("rejects unsafe registrations: %j", (uris) => {
		expect(() => validateOidcRedirectUris(uris)).toThrow();
	});
});
