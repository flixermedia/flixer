import { describe, expect, it } from "vitest";
import { assertPublicRepositoryAddresses, isPublicRepositoryAddress } from "./pluginRepositoryClient.js";
import { normalizePluginRepositoryUrl } from "./pluginRepositoryUrl.js";

describe("normalizePluginRepositoryUrl", () => {
	it("normalizes public HTTPS repository manifests", () => {
		expect(normalizePluginRepositoryUrl("https://example.org/plugins/repository.json")).toBe(
			"https://example.org/plugins/repository.json",
		);
	});

	it.each([
		"http://example.org/repository.json",
		"https://user:pass@example.org/repository.json",
		"https://127.0.0.1/repository.json",
		"https://localhost/repository.json",
		"https://example.org:8443/repository.json",
		"https://example.org/plugins/",
	])("rejects unsupported repository URLs: %s", (url) => {
		expect(() => normalizePluginRepositoryUrl(url)).toThrow("Repository URL");
	});

	it("accepts globally routable addresses and rejects private or reserved ranges", () => {
		expect(isPublicRepositoryAddress("8.8.8.8")).toBe(true);
		expect(isPublicRepositoryAddress("2606:4700:4700::1111")).toBe(true);
		for (const address of ["127.0.0.1", "10.0.0.1", "169.254.1.1", "192.0.2.1", "::1", "fc00::1", "fe80::1", "::ffff:127.0.0.1"]) {
			expect(isPublicRepositoryAddress(address)).toBe(false);
		}
	});

	it("rejects private DNS results before an HTTP request", () => {
		expect(() => assertPublicRepositoryAddresses([{ address: "127.0.0.1", family: 4 }])).toThrow(
			"non-public network address",
		);
		expect(() => assertPublicRepositoryAddresses([])).toThrow("did not resolve");
	});
});