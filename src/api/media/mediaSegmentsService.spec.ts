import { describe, expect, it, vi } from "vitest";
import type { DataSource } from "typeorm";
import { MediaItem } from "../../entities/mediaItem.entity.js";
import { MediaSegment } from "../../entities/mediaSegment.entity.js";
import { Setting } from "../../entities/setting.entity.js";
import type { PluginSegmentProvider, SegmentLookupOutcome } from "../plugins/pluginSegmentProvider.js";
import { MediaSegmentsService } from "./mediaSegmentsService.js";

function setup(outcome: SegmentLookupOutcome) {
	const segments = {
		findBy: vi.fn(async () => []),
		save: vi.fn(async () => undefined),
		delete: vi.fn(async () => undefined),
	};
	const settings = { findOneBy: vi.fn(async () => ({ value: "https://db.example/v3" })) };
	const dataSource = {
		getRepository: (entity: unknown) =>
			entity === MediaSegment ? segments : entity === Setting ? settings : { findOneBy: vi.fn() },
	} as unknown as DataSource;
	const lookup = vi.fn(async () => outcome);
	const service = new MediaSegmentsService(dataSource, { lookup } as unknown as PluginSegmentProvider);
	return { service, segments, lookup };
}

const movie = {
	id: "m1",
	type: "movie",
	providerIds: { tmdb: "603", imdb: "tt0133093" },
	technical: { duration: 120 },
} as unknown as MediaItem;

describe("MediaSegmentsService with a segment-provider plugin", () => {
	it("stores provided segments, clears null ones and leaves absent types alone", async () => {
		const { service, segments, lookup } = setup({
			status: "ok",
			segments: { intro: { startMs: 1000, endMs: 5000, submissions: 3 }, recap: null },
		});

		await service.forItem(movie);

		expect(lookup).toHaveBeenCalledWith(
			{ type: "movie", durationMs: 120000, providerIds: { tmdb: "603", imdb: "tt0133093" } },
			{ baseUrl: "https://db.example/v3" },
		);
		expect(segments.save).toHaveBeenCalledWith({
			itemId: "m1",
			type: "intro",
			source: "skipme",
			startMs: 1000,
			endMs: 5000,
			submissions: 3,
		});
		expect(segments.delete).toHaveBeenCalledTimes(1);
		expect(segments.delete).toHaveBeenCalledWith({ itemId: "m1", type: "recap", source: "skipme" });
	});

	it("does not fall back to the built-in lookup when an active provider fails", async () => {
		const fetchSpy = vi.spyOn(globalThis, "fetch");
		const { service, segments } = setup({ status: "failed" });

		await service.forItem(movie);

		expect(fetchSpy).not.toHaveBeenCalled();
		expect(segments.save).not.toHaveBeenCalled();
		fetchSpy.mockRestore();
	});

	it("uses the built-in lookup only when no provider is active", async () => {
		const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("[null]"));
		const { service } = setup({ status: "no-provider" });

		await service.forItem(movie);

		expect(fetchSpy).toHaveBeenCalledOnce();
		fetchSpy.mockRestore();
	});
});
