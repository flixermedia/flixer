import { afterEach, describe, expect, it, vi } from "vitest";
import type { DataSource } from "typeorm";
import { ExternalMetadataService } from "./externalMetadataService.js";

describe("TMDB trailer lookup", () => {
	afterEach(() => vi.unstubAllGlobals());

	function service(language = "en") {
		const rows = [
			{ key: "indexer_providers", value: { tmdb: { enabled: true, apiKey: "test-key" } } },
			{ key: "indexer_language", value: language },
		];
		return new ExternalMetadataService({ getRepository: () => ({ find: vi.fn().mockResolvedValue(rows) }) } as unknown as DataSource);
	}

	it("selects the most recent official YouTube trailer and rejects other video types and invalid keys", async () => {
		const fetch = vi.fn().mockResolvedValue(
			new Response(
				JSON.stringify({
					results: [
						{ site: "YouTube", type: "Trailer", key: "aaaaaaaaaaa", name: "Unofficial", official: false, published_at: "2025-01-01" },
						{ site: "YouTube", type: "Trailer", key: "bbbbbbbbbbb", name: "Official", official: true, published_at: "2024-01-01" },
						{ site: "YouTube", type: "Teaser", key: "ccccccccccc", official: true },
						{ site: "YouTube", type: "Trailer", key: "../evil", official: true },
						{ site: "Vimeo", type: "Trailer", key: "ddddddddddd", official: true },
					],
				}),
				{ status: 200 },
			),
		);
		vi.stubGlobal("fetch", fetch);
		await expect(service().trailer("movie", "42")).resolves.toEqual({ key: "bbbbbbbbbbb", name: "Official" });
		expect(String(fetch.mock.calls[0][0])).toContain("/movie/42/videos");
	});

	it("falls back to English for a missing localized trailer", async () => {
		const fetch = vi
			.fn()
			.mockResolvedValueOnce(new Response(JSON.stringify({ results: [] }), { status: 200 }))
			.mockResolvedValueOnce(new Response(JSON.stringify({ results: [{ site: "YouTube", type: "Trailer", key: "abcdefghijk" }] }), { status: 200 }));
		vi.stubGlobal("fetch", fetch);
		await expect(service("de").trailer("tv", "42")).resolves.toEqual({ key: "abcdefghijk", name: "Trailer" });
		expect(new URL(String(fetch.mock.calls[1][0])).searchParams.get("language")).toBe("en-US");
	});

	it("surfaces provider errors", async () => {
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 503 })));
		await expect(service().trailer("movie", "42")).rejects.toThrow("HTTP 503");
	});

	it("returns no trailer without an English fallback when already configured for English", async () => {
		const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ results: [] }), { status: 200 }));
		vi.stubGlobal("fetch", fetch);
		await expect(service("en-US").trailer("movie", "42")).resolves.toBeNull();
		expect(fetch).toHaveBeenCalledOnce();
	});

	it("rejects invalid provider identifiers before making a request", async () => {
		const fetch = vi.fn();
		vi.stubGlobal("fetch", fetch);
		await expect(service().trailer("movie", "../42")).rejects.toThrow("Invalid TMDB ID.");
		expect(fetch).not.toHaveBeenCalled();
	});
});
