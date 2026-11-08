import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rename, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import type { DataSource } from "typeorm";
import { MediaItem } from "../../entities/mediaItem.entity.js";
import { MediaItemsService, mergeIndexerProviderIds, parseItemPayload } from "./mediaItemsService.js";

describe("conflicting media sources", () => {
	it("returns only explicitly corrected provider IDs for the exact source", async () => {
		const dataSource = {
			getRepository: () => ({
				findOneBy: async (where: { path: string }) => where.path === "/tv/A" ? {
					providerIds: { tmdb: "correct", tvdb: "stale" },
					editedFields: ["providerId:tmdb", "title"],
				} : null,
			}),
		} as unknown as DataSource;
		const service = new MediaItemsService(dataSource, {} as never);
		await expect(service.manualMatch("library", "series", "/tv/A")).resolves.toEqual({ tmdb: "correct" });
		await expect(service.manualMatch("library", "series", "/tv/B")).resolves.toEqual({});
	});

	it("preserves both trees when children arrive before parents and on later scans", async () => {
		const root = await mkdtemp(join(tmpdir(), "flixer-identity-"));
		try {
			for (const name of ["A", "B"]) {
				await mkdir(join(root, name, "Season 1"), { recursive: true });
				await writeFile(join(root, name, "Season 1", "episode.mkv"), "");
			}
			const rows: MediaItem[] = [];
			const manager = {
				existsBy: async () => true,
				query: async () => undefined,
				findOneBy: async (_entity: unknown, where: Partial<MediaItem>) =>
					rows.find((row) => Object.entries(where).every(([key, value]) => row[key as keyof MediaItem] === value)) ?? null,
				create: (_entity: unknown, value: Partial<MediaItem>) => ({ ...value }) as MediaItem,
				save: async (item: MediaItem) => {
					if (!rows.some((row) => row.id === item.id)) rows.push(item);
					return item;
				},
				update: async (_entity: unknown, where: { parentId: string }, value: { parentId: string }) => {
					for (const row of rows) if (row.parentId === where.parentId) row.parentId = value.parentId;
				},
				delete: async (entity: unknown, where: { id?: string }) => {
					if (entity === MediaItem) {
						const index = rows.findIndex((row) => row.id === where.id);
						if (index >= 0) rows.splice(index, 1);
					}
				},
				insert: async () => undefined,
			};
			const dataSource = { transaction: (run: (manager: never) => Promise<unknown>) => run(manager as never) } as unknown as DataSource;
			const service = new MediaItemsService(dataSource, { announceNew: () => undefined } as never);
			const libraryId = "97a37f33-0fd0-4bfc-a0b0-55ef759d9da2";
			const insert = (type: string, path: string, key: string, extra: Record<string, unknown> = {}) =>
				service.upsert(parseItemPayload({ libraryId, type, path, rootId: "root", relativePath: relative(root, path), externalKey: key, metadata: { title: path }, ...extra }));
			for (const name of ["A", "B"]) {
				const seriesPath = join(root, name);
				const seasonPath = join(seriesPath, "Season 1");
				await insert("episode", join(seasonPath, "episode.mkv"), "tmdb:100:s1:e1", {
					parentPath: seasonPath, seriesPath, parentExternalKey: "tmdb:100:s1", seasonNumber: 1, episodeNumber: 1,
				});
				await insert("season", seasonPath, "tmdb:100:s1", { parentPath: seriesPath, parentExternalKey: "tmdb:100", seasonNumber: 1 });
				await insert("series", seriesPath, "tmdb:100");
			}
			expect(rows).toHaveLength(6);
			for (const name of ["A", "B"]) {
				const series = rows.find((row) => row.path === join(root, name))!;
				const season = rows.find((row) => row.path === join(root, name, "Season 1"))!;
				const episode = rows.find((row) => row.path === join(root, name, "Season 1", "episode.mkv"))!;
				expect(series.isPlaceholder).toBe(false);
				expect(season.parentId).toBe(series.id);
				expect(episode.parentId).toBe(season.id);
				await insert("series", series.path, "tmdb:100");
				await insert("episode", episode.path, "tmdb:100:s1:e1", {
					parentPath: season.path, seriesPath: series.path, parentExternalKey: "tmdb:100:s1", seasonNumber: 1, episodeNumber: 1,
				});
			}
			expect(rows).toHaveLength(6);
			expect(new Set(rows.map((row) => row.externalKey)).size).toBe(6);
			const original = join(root, "Moved");
			const moved = join(root, "Renamed");
			await mkdir(original);
			const old = await insert("series", original, "tmdb:999");
			await rename(original, moved);
			expect(await insert("series", moved, "tmdb:999")).toEqual(old);
			expect(rows.find((row) => row.id === old.id)?.path).toBe(moved);
			expect(await insert("series", join(root, "missing"), "tmdb:999", { updateFields: ["images"] })).toEqual({ id: "" });
			const seasonPath = join(moved, "Season 1");
			await mkdir(seasonPath);
			await writeFile(join(seasonPath, "episode.mkv"), "");
			const oldSeason = await insert("season", seasonPath, "tmdb:999:s1", { parentPath: moved, parentExternalKey: "tmdb:999", seasonNumber: 1 });
			const oldEpisode = await insert("episode", join(seasonPath, "episode.mkv"), "tmdb:999:s1:e1", {
				parentPath: seasonPath, seriesPath: moved, parentExternalKey: "tmdb:999:s1", seasonNumber: 1, episodeNumber: 1,
			});
			const finalPath = join(root, "Renamed again");
			await rename(moved, finalPath);
			const finalSeason = join(finalPath, "Season 1");
			expect(await insert("episode", join(finalSeason, "episode.mkv"), "tmdb:999:s1:e1", {
				parentPath: finalSeason, seriesPath: finalPath, parentExternalKey: "tmdb:999:s1", seasonNumber: 1, episodeNumber: 1,
			})).toEqual(oldEpisode);
			expect(await insert("series", finalPath, "tmdb:999")).toEqual(old);
			expect(await insert("season", finalSeason, "tmdb:999:s1", {
				parentPath: finalPath, parentExternalKey: "tmdb:999", seasonNumber: 1,
			})).toEqual(oldSeason);
			expect(rows.find((row) => row.id === oldEpisode.id)?.parentId).toBe(oldSeason.id);
			expect(rows.find((row) => row.id === oldSeason.id)?.parentId).toBe(old.id);
			expect(rows.filter((row) => row.isPlaceholder)).toHaveLength(0);

			const correctedPath = join(root, "Corrected");
			const correctedNewPath = join(root, "Corrected renamed");
			await mkdir(correctedPath);
			const corrected = await insert("series", correctedPath, "tmdb:stale", { providerIds: { tmdb: "stale" } });
			const correctedRow = rows.find((row) => row.id === corrected.id)!;
			correctedRow.providerIds = { tmdb: "manual" };
			correctedRow.editedFields = ["providerId:tmdb"];
			await rename(correctedPath, correctedNewPath);
			const uncertain = await insert("series", correctedNewPath, "tmdb:stale", { providerIds: { tmdb: "stale" }, metadata: { title: "Wrong match" } });
			expect(uncertain.id).not.toBe(corrected.id);
			expect(correctedRow.path).toBe(correctedPath);
			expect(correctedRow.providerIds.tmdb).toBe("manual");
			expect(correctedRow.title).not.toBe("Wrong match");

			const confirmedPath = join(root, "Confirmed");
			const confirmedNewPath = join(root, "Confirmed renamed");
			await mkdir(confirmedPath);
			const confirmed = await insert("series", confirmedPath, "tmdb:confirmed", { providerIds: { tmdb: "confirmed" } });
			rows.find((row) => row.id === confirmed.id)!.editedFields = ["providerId:tmdb"];
			await rename(confirmedPath, confirmedNewPath);
			expect(await insert("series", confirmedNewPath, "tmdb:confirmed", { providerIds: { tmdb: "confirmed" } })).toEqual(confirmed);
			expect(rows.find((row) => row.id === confirmed.id)?.path).toBe(confirmedNewPath);

			const offlineRoot = join(root, "offline-root");
			const otherRoot = join(root, "other-root");
			await mkdir(join(offlineRoot, "Show"), { recursive: true });
			await mkdir(join(otherRoot, "Show"), { recursive: true });
			const offline = await insert("series", join(offlineRoot, "Show"), "tmdb:offline", { rootId: "share", relativePath: "Show" });
			await rename(offlineRoot, join(root, "offline-root-hidden"));
			const other = await insert("series", join(otherRoot, "Show"), "tmdb:offline", { rootId: "share", relativePath: "Show" });
			expect(other.id).not.toBe(offline.id);
			expect(rows.find((row) => row.id === offline.id)?.path).toBe(join(offlineRoot, "Show"));
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});

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
