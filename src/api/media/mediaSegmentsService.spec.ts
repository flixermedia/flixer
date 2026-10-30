import { describe, expect, it, vi } from "vitest";
import type { DataSource } from "typeorm";
import { MediaItem } from "../../entities/mediaItem.entity.js";
import { MediaSegment } from "../../entities/mediaSegment.entity.js";
import type { PluginSegmentProvider, SegmentLookupOutcome } from "../plugins/pluginSegmentProvider.js";
import { MediaSegmentsService } from "./mediaSegmentsService.js";

function setup(outcome: SegmentLookupOutcome) {
	const segments = {
		findBy: vi.fn(async () => []),
		save: vi.fn(async () => undefined),
		delete: vi.fn(async () => undefined),
	};
	const dataSource = {
		getRepository: (entity: unknown) =>
			entity === MediaSegment ? segments : { findOneBy: vi.fn(async () => null) },
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
	it("returns indexed timing data without invoking a provider during playback", async () => {
		const { service, lookup } = setup({ status: "no-provider" });
		const repository = service as unknown as { dataSource: DataSource };
		const stored = {
			itemId: "m1",
			type: "intro",
			startMs: 1000,
			endMs: 5000,
			source: "theintrodb",
		};
		vi.spyOn(repository.dataSource, "getRepository").mockReturnValue({
			findBy: vi.fn(async (where: { source?: string }) => where.source === "plugin" ? [] : [stored]),
		} as never);

		const result = await service.forItem(movie);

		expect(lookup).not.toHaveBeenCalled();
		expect(result.segments).toContainEqual({ type: "intro", startMs: 1000, endMs: 5000, source: "theintrodb" });
	});

	it("stores plugin segments, clears null ones and leaves absent types alone", async () => {
		const { service, segments, lookup } = setup({
			status: "ok",
			segments: { intro: { startMs: 1000, endMs: 5000, submissions: 3 }, recap: null },
		});

		await service.forItem(movie);

		expect(lookup).toHaveBeenCalledWith(
			{ type: "movie", durationMs: 120000, providerIds: { tmdb: "603", imdb: "tt0133093" } },
			{ baseUrl: "" },
		);
		expect(segments.save).toHaveBeenCalledWith({
			itemId: "m1",
			type: "intro",
			source: "plugin",
			startMs: 1000,
			endMs: 5000,
			submissions: 3,
		});
		expect(segments.delete).toHaveBeenCalledTimes(1);
		expect(segments.delete).toHaveBeenCalledWith({ itemId: "m1", type: "recap", source: "plugin" });
	});

	it("does not fall back to the built-in lookup when an active provider fails", async () => {
		const fetchSpy = vi.spyOn(globalThis, "fetch");
		const { service, segments } = setup({ status: "failed" });

		await service.forItem(movie);

		expect(fetchSpy).not.toHaveBeenCalled();
		expect(segments.save).not.toHaveBeenCalled();
		fetchSpy.mockRestore();
	});

	it("does not make transient external lookups when no segment plugin is installed", async () => {
		const fetchSpy = vi.spyOn(globalThis, "fetch");
		const { service } = setup({ status: "no-provider" });

		await service.forItem(movie);

		expect(fetchSpy).not.toHaveBeenCalled();
		fetchSpy.mockRestore();
	});
});
