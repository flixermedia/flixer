import { describe, expect, it } from "vitest";
import type { DataSource } from "typeorm";
import { MediaItem } from "../../entities/mediaItem.entity.js";
import { MediaItemsService, mergeIndexerProviderIds, parseItemPayload } from "./mediaItemsService.js";

describe("mergeIndexerProviderIds", () => {
	it("keeps manually edited provider IDs while accepting other IDs from rescans", () => {
		expect(mergeIndexerProviderIds({ tmdb: "discovered", imdb: "tt123" }, { tmdb: "manual", custom: "custom-id" }, ["providerId:tmdb", "providerId:custom"])).toEqual({ tmdb: "manual", imdb: "tt123", custom: "custom-id" });
	});

	describe("parseItemPayload updateFields", () => {
		const base = {
			libraryId: "97a37f33-0fd0-4bfc-a0b0-55ef759d9da2",
			type: "movie",
			path: "/movies/example.mkv",
			externalKey: "path:/movies/example.mkv",
		};

		it("accepts unique targeted update fields", () => {
			expect(parseItemPayload({ ...base, updateFields: ["images", "fileData", "lyrics"] }).updateFields).toEqual(["images", "fileData", "lyrics"]);
		});

		describe("MediaItemsService partial updates", () => {
			function setup(item: Partial<MediaItem>) {

				const current = { ...item, id: "media-id", isPlaceholder: false } as MediaItem;
				const manager = {
					existsBy: async () => true,
					query: async () => undefined,
					findOneBy: async () => current,
					delete: async () => undefined,
					save: async (value: MediaItem) => value,
					insert: async () => undefined,
				};
				const dataSource = {
					transaction: (run: (manager: never) => Promise<unknown>) => run(manager as never),
				} as unknown as DataSource;
				return { service: new MediaItemsService(dataSource, {} as never), current };

			}

			it("updates only images while retaining other image types and existing media data", async () => {
				const { service, current } = setup({
					libraryId: "97a37f33-0fd0-4bfc-a0b0-55ef759d9da2",
					type: "movie",
					path: "/movies/example.mkv",
					externalKey: "tmdb:123",
					title: "Existing title",
					metadata: { overview: "Existing description" },
					images: [
						{ type: "poster", path: "/old.jpg", provider: "tmdb" },
						{ type: "backdrop", path: "/backdrop.jpg", provider: "tmdb" },
						{ type: "logo", path: "/manual.png", provider: "manual" },
					],
					technical: { videoCodec: "h264" },
					editedFields: [],
				});

				await service.upsert(
					parseItemPayload({
						libraryId: current.libraryId,
						type: current.type,
						path: current.path,
						externalKey: current.externalKey,
						metadata: { title: "New title" },
						images: [{ type: "poster", path: "/new.jpg", provider: "tmdb" }],
						updateFields: ["images"],
					}),
				);

				expect(current.title).toBe("Existing title");
				expect(current.metadata).toEqual({ overview: "Existing description" });
				expect(current.technical).toEqual({ videoCodec: "h264" });
				expect(current.images).toEqual([
					{ type: "poster", path: "/new.jpg", provider: "tmdb" },
					{ type: "backdrop", path: "/backdrop.jpg", provider: "tmdb" },
					{ type: "logo", path: "/manual.png", provider: "manual" },
				]);
			});

			it("updates descriptions without clearing missing metadata or technical details", async () => {
				const { service, current } = setup({
					libraryId: "97a37f33-0fd0-4bfc-a0b0-55ef759d9da2",
					type: "movie",
					path: "/movies/example.mkv",
					externalKey: "tmdb:123",
					title: "Existing title",
					metadata: { overview: "Old description", tagline: "Keep me" },
					images: [{ type: "poster", path: "/poster.jpg", provider: "tmdb" }],
					technical: { videoCodec: "h264" },
					editedFields: [],
				});

				await service.upsert(
					parseItemPayload({
						libraryId: current.libraryId,
						type: current.type,
						path: current.path,
						externalKey: current.externalKey,
						metadata: { title: "New title", overview: "Updated description", tagline: "" },
						images: [],
						updateFields: ["descriptions"],
					}),
				);

				expect(current.title).toBe("New title");
				expect(current.metadata).toEqual({
					overview: "Updated description",
					tagline: "Keep me",
					title: "New title",
				});
				expect(current.images).toEqual([{ type: "poster", path: "/poster.jpg", provider: "tmdb" }]);
				expect(current.technical).toEqual({ videoCodec: "h264" });
			});

			it("preserves manually edited chapters when rescanning the media item", async () => {
				const adminChapters = [{ title: "Manual chapter", start: 2, end: 8 }];
				const { service, current } = setup({
					libraryId: "97a37f33-0fd0-4bfc-a0b0-55ef759d9da2",
					type: "movie",
					path: "/movies/example.mkv",
					externalKey: "tmdb:123",
					title: "Existing title",
					metadata: { adminChapters },
					images: [],
					technical: { chapters: [{ title: "Indexed chapter", start: 0, end: 12 }] },
					editedFields: ["chapters"],
				});

				await service.upsert(
					parseItemPayload({
						libraryId: current.libraryId,
						type: current.type,
						path: current.path,
						externalKey: current.externalKey,
						metadata: { title: "New title" },
						images: [],
						technical: { chapters: [{ title: "New indexed chapter", start: 0, end: 15 }] },
					}),
				);

				expect(current.metadata.adminChapters).toEqual(adminChapters);
				expect(current.technical).toEqual({ chapters: [{ title: "New indexed chapter", start: 0, end: 15 }] });
			});

			it.each([undefined, ["fileData"]])("normalizes indexed chapter titles on full and file-data updates (%s)", async (updateFields) => {
				const { service, current } = setup({
					libraryId: "97a37f33-0fd0-4bfc-a0b0-55ef759d9da2",
					type: "movie", path: "/movies/example.mkv", externalKey: "tmdb:123",
					title: "Movie", metadata: {}, images: [], editedFields: [],
				});
				await service.upsert(parseItemPayload({
					libraryId: current.libraryId, type: current.type, path: current.path, externalKey: current.externalKey,
					metadata: { title: "Movie" }, images: [], updateFields,
					technical: { chapters: [{ title: "00:00:00.000", start: 0, end: 5 }, { title: "Opening", start: 5, end: 10 }, { title: "00:00:10.000", start: 10, end: 15 }] },
				}));
				expect(current.technical?.chapters).toEqual([
					{ title: "Chapter 1", start: 0, end: 5 },
					{ title: "Opening", start: 5, end: 10 },
					{ title: "Chapter 3", start: 10, end: 15 },
				]);
			});
		});

		describe("MediaItemsService.removePaths", () => {
			it("deletes only the requested exact paths and recursive subtrees", async () => {
				const targets = [
					{ path: "/movies/removed.mkv", recursive: false },
					{ path: "/movies/removed-show", recursive: true },
				];
				let query = "";
				let params: unknown[] = [];
				const manager = {
					existsBy: async () => true,
					query: async (sql: string, values: unknown[]) => {
						query = sql;
						params = values;
						return [{ id: "removed-1" }, { id: "removed-2" }];
					},
				};
				const dataSource = {
					transaction: (run: (manager: never) => Promise<unknown>) => run(manager as never),
				} as unknown as DataSource;
				const service = new MediaItemsService(dataSource, {} as never);

				await expect(service.removePaths("library-id", targets)).resolves.toEqual({ removed: 2 });
				expect(query).toContain("DELETE FROM media_items");
				expect(query).toContain("RETURNING id");
				expect(params).toEqual(["library-id", "/movies/removed.mkv", false, "/movies/removed-show", true]);
			});

			it("does not delete paths when the library does not exist", async () => {
				const manager = {
					existsBy: async () => false,
					query: async () => {
						throw new Error("query should not run");
					},
				};
				const dataSource = {
					transaction: (run: (manager: never) => Promise<unknown>) => run(manager as never),
				} as unknown as DataSource;
				const service = new MediaItemsService(dataSource, {} as never);

				await expect(service.removePaths("missing-library", [{ path: "/movies/a.mkv", recursive: false }])).rejects.toThrow("Media library not found.");
			});
		});

		it("rejects unknown, duplicate, or empty targeted update fields", () => {
			for (const updateFields of [["unknown"], ["images", "images"], []]) {
				expect(() => parseItemPayload({ ...base, updateFields })).toThrow();
			}
		});
	});

	it("lets rescans replace IDs after their manual override is cleared", () => {
		expect(mergeIndexerProviderIds({ tmdb: "discovered" }, {}, [])).toEqual({ tmdb: "discovered" });
	});
});
