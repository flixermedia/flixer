import { BadRequest } from "@tsed/exceptions";
import { describe, expect, it, vi } from "vitest";
import { In, type DataSource } from "typeorm";
import { MediaItem } from "../../entities/mediaItem.entity.js";
import { MediaSegment } from "../../entities/mediaSegment.entity.js";
import { IndexerIntroSegmentsService, parseIntroSegmentUpdate } from "./indexerIntroSegmentsService.js";

const itemId = "97a37f33-0fd0-4bfc-a0b0-55ef759d9da2";

describe("parseIntroSegmentUpdate", () => {
	it("accepts bounded intro and credits ranges", () => {
		expect(
			parseIntroSegmentUpdate({
				itemId: itemId.toUpperCase(),
				segments: { intro: { startMs: 0, endMs: 90_000 }, credits: null },
			}),
		).toEqual({
			itemId,
			segments: { intro: { startMs: 0, endMs: 90_000 }, credits: null },
		});
	});

	it("rejects malformed, unsupported and out-of-range values", () => {
		for (const value of [
			{ itemId, segments: { intro: { startMs: 1.5, endMs: 2 } } },
			{ itemId, segments: { recap: { startMs: 1, endMs: 2 } } },
			{ itemId, segments: { credits: { startMs: 5, endMs: 5 } } },
			{ itemId: "not-an-id", segments: {} },
		]) {
			expect(() => parseIntroSegmentUpdate(value)).toThrow(BadRequest);
		}
	});
});

describe("IndexerIntroSegmentsService", () => {
	it("reports which intro and credits results already exist", async () => {
		const repository = {
			find: vi.fn(async () => [{ type: "intro" }, { type: "credits" }]),
		};
		const service = new IndexerIntroSegmentsService({ getRepository: () => repository } as unknown as DataSource);

		await expect(service.existing(itemId)).resolves.toEqual({ intro: true, credits: true });
		expect(repository.find).toHaveBeenCalledWith({
			where: { itemId, type: In(["intro", "credits"]) },
			select: { type: true },
		});
	});

	it("replaces only TheIntroDB-owned timings", async () => {
		const mediaItemRepository = {
			findOneBy: vi.fn(async () => ({ id: itemId, type: "movie", isPlaceholder: false })),
		};
		const segments = { delete: vi.fn(async () => undefined), save: vi.fn(async () => undefined) };
		const manager = {
			getRepository: (entity: unknown) => (entity === MediaItem ? mediaItemRepository : segments),
			query: vi.fn(async () => undefined),
		};
		const dataSource = {
			transaction: (run: (manager: never) => Promise<void>) => run(manager as never),
		} as unknown as DataSource;
		const service = new IndexerIntroSegmentsService(dataSource);

		await service.replace(parseIntroSegmentUpdate({ itemId, segments: { intro: { startMs: 10, endMs: 20 } } }));

		expect(segments.delete).toHaveBeenCalledWith({ itemId, source: "theintrodb" });
		expect(segments.save).toHaveBeenCalledWith([
			{ itemId, type: "intro", source: "theintrodb", startMs: 10, endMs: 20, submissions: 0 },
		]);
	});

	it("uses a series TVDB id and episode numbers for episode backfill candidates", async () => {
		const item = {
			id: itemId,
			type: "episode",
			parentId: "season-id",
			seasonNumber: 2,
			episodeNumber: 3,
			technical: { duration: 1800 },
		};
		const season = { id: "season-id", parentId: "series-id" };
		const series = { id: "series-id", type: "series", providerIds: { tvdb: "71663" } };
		const repository = {
			find: vi.fn().mockResolvedValueOnce([item]).mockResolvedValueOnce([season]).mockResolvedValueOnce([series]),
		};
		const service = new IndexerIntroSegmentsService({ getRepository: () => repository } as unknown as DataSource);

		const result = await service.candidates("episode", undefined, 100);

		expect(result.items).toEqual([
			{
				id: itemId,
				type: "episode",
				providerIds: { tvdb: "71663" },
				durationMs: 1_800_000,
				season: 2,
				episode: 3,
			},
		]);
	});

	it("filters candidate pages to the selected library", async () => {
		const repository = { find: vi.fn().mockResolvedValue([]) };
		const service = new IndexerIntroSegmentsService({ getRepository: () => repository } as unknown as DataSource);

		await service.candidates("movie", undefined, 100, itemId);

		expect(repository.find).toHaveBeenCalledWith(
			expect.objectContaining({
				where: { type: "movie", isPlaceholder: false, libraryId: itemId },
			}),
		);
	});
});
