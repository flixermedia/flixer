import { describe, expect, it, vi } from "vitest";
import type { DataSource } from "typeorm";
import { MediaItem } from "../../entities/mediaItem.entity.js";
import { Playlist } from "../../entities/playlist.entity.js";
import { UserPreference } from "../../entities/userPreference.entity.js";
import { UpNextQueueItem } from "../../entities/userMediaQueue.entity.js";
import { FavoritesService } from "./favoritesService.js";
import { FriendsService } from "./friendsService.js";
import { PlaylistsService } from "./playlistsService.js";
import { ProfilesService, isFresh, likePattern, PRESENCE_MS } from "./profilesService.js";
import { UserMediaController } from "./userMediaController.js";
import { UserMediaService } from "./userMediaService.js";
import { artistOf, durationOf, imageIndexOf } from "./socialItems.js";

const USER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const TRACK = "33333333-3333-4333-8333-333333333333";

describe("personal media", () => {
	it("bounds history pages and filters inaccessible items", async () => {
		const entries = [
			{ kind: "video", item: { id: TRACK }, sourceItemIds: [TRACK] },
			{ kind: "live", item: null, sourceItemIds: [] },
			{ kind: "video", item: { id: OTHER }, sourceItemIds: [OTHER] },
		];
		const userMedia = { history: vi.fn().mockResolvedValue(entries) };
		const access = { resolve: vi.fn().mockResolvedValue({ userId: USER }), visibleIds: vi.fn().mockResolvedValue(new Set()) };
		const controller = new UserMediaController({} as never, userMedia as never, access as never);
		await expect(controller.history("token", 10, 2)).resolves.toEqual({ entries: [{ kind: "live", item: null }], hasMore: true });
		expect(userMedia.history).toHaveBeenCalledWith(USER, 10, 3);
	});

	it("does not reveal a series group when any underlying episode is restricted", async () => {
		const entry = { kind: "video", item: { id: TRACK }, sourceItemIds: [OTHER] };
		const userMedia = { history: vi.fn().mockResolvedValue([entry]) };
		const access = { resolve: vi.fn().mockResolvedValue({ userId: USER }), visibleIds: vi.fn().mockResolvedValue(new Set([TRACK])) };
		const controller = new UserMediaController({} as never, userMedia as never, access as never);
		await expect(controller.history("token")).resolves.toEqual({ entries: [], hasMore: false });
		expect(access.visibleIds).toHaveBeenCalledWith({ userId: USER }, [TRACK, OTHER]);
	});

	it("returns a visible parent group without exposing underlying item IDs", async () => {
		const entry = { kind: "music", item: { id: TRACK }, sourceItemIds: [OTHER] };
		const userMedia = { history: vi.fn().mockResolvedValue([entry]) };
		const access = { resolve: vi.fn().mockResolvedValue({ userId: USER }), visibleIds: vi.fn().mockResolvedValue(new Set([TRACK, OTHER])) };
		const controller = new UserMediaController({} as never, userMedia as never, access as never);
		await expect(controller.history("token")).resolves.toEqual({ entries: [{ kind: "music", item: { id: TRACK } }], hasMore: false });
	});

	it("only adds media visible to the authenticated user", async () => {
		const userMedia = { addWatchLater: vi.fn() };
		const access = { resolve: vi.fn().mockResolvedValue({ userId: USER }), isVisible: vi.fn().mockResolvedValue(false) };
		const controller = new UserMediaController({} as never, userMedia as never, access as never);
		await expect(controller.addWatchLater(TRACK, "token")).rejects.toThrow(/not found/i);
		expect(userMedia.addWatchLater).not.toHaveBeenCalled();
		access.isVisible.mockResolvedValue(true);
		await controller.addWatchLater(TRACK, "token");
		expect(userMedia.addWatchLater).toHaveBeenCalledWith(USER, TRACK);
	});

	it("keeps history deletion scoped to the authenticated user and suppresses late reports", async () => {
		const { source, query } = dataSource();
		const service = new UserMediaService(source, {} as never);
		await service.removeHistory(USER, TRACK);
		expect(query).toHaveBeenCalledWith(expect.stringContaining("playback_history_hidden_sessions"), [USER, TRACK]);
		expect(query.mock.calls[0][0]).toContain("WHERE history.user_id = $1");
		expect(query.mock.calls[0][0]).toContain("SELECT group_number FROM grouped_history WHERE id = $2");
	});

	it("rejects music from the video watch-later list", async () => {
		const { source } = dataSource({ item: { id: TRACK, type: "track" } });
		await expect(new UserMediaService(source, {} as never).addWatchLater(USER, TRACK)).rejects.toThrow(/video items/i);
	});

	it("rejects non-playable series from the queue", async () => {
		const { source } = dataSource({ item: { id: TRACK, type: "series" } });
		await expect(new UserMediaService(source, {} as never).addToQueue(USER, TRACK)).rejects.toThrow(/video items/i);
	});

	it("hides private or profile-hidden collections from other users", async () => {
		const { source, query } = dataSource({ visibility: "hidden" });
		const collection = { id: TRACK, user_id: OTHER, name: "Private", description: null, is_public: false, item_count: 0 };
		query.mockResolvedValueOnce([collection]);
		await expect(new UserMediaService(source, {} as never).collection(USER, TRACK)).rejects.toThrow(/not found/i);
		query.mockResolvedValueOnce([{ ...collection, is_public: true }]);
		await expect(new UserMediaService(source, {} as never).collection(USER, TRACK)).rejects.toThrow(/not found/i);
	});

	it("removes a queue item only for its owner", async () => {
		const { source } = dataSource();
		const remove = vi.fn(async () => ({}));
		const { manager } = lockingManager({ delete: remove });
		source.transaction = vi.fn(async (callback) => callback(manager)) as never;
		await new UserMediaService(source, {} as never).removeFromQueue(USER, TRACK);
		expect(remove).toHaveBeenCalledWith(UpNextQueueItem, { userId: USER, itemId: TRACK });
	});

	it("rejects duplicate or incomplete queue orders and locks the owner row", async () => {
		const { manager, builder } = lockingManager({ query: vi.fn(async () => []), find: vi.fn(async () => [{ itemId: TRACK }]) });
		const source = { transaction: vi.fn(async (callback) => callback(manager)) } as unknown as DataSource;
		const service = new UserMediaService(source, {} as never);
		await expect(service.reorderQueue(USER, [TRACK, TRACK])).rejects.toThrow(/invalid queue order/i);
		expect(source.transaction).not.toHaveBeenCalled();
		await expect(service.reorderQueue(USER, [])).rejects.toThrow(/every queued item/i);
		await service.reorderQueue(USER, [TRACK]);
		expect(builder.setLock).toHaveBeenCalledWith("pessimistic_write");
		expect(builder.where).toHaveBeenCalledWith("user.id = :userId", { userId: USER });
		expect(manager.query).toHaveBeenCalledWith(expect.stringContaining("WITH ORDINALITY"), [USER, [TRACK]]);
	});
});

function lockingManager<T extends object>(base: T) {

	const builder = { select: vi.fn(), setLock: vi.fn(), where: vi.fn(), getOne: vi.fn(async () => ({ id: USER })) };
	for (const key of ["select", "setLock", "where"] as const) builder[key].mockReturnValue(builder);
	return { manager: { ...base, createQueryBuilder: vi.fn(() => builder) }, builder };

}

function dataSource(options: { item?: Partial<MediaItem> | null; queries?: Array<unknown[]>; visibility?: string } = {}) {

	const query = vi.fn(async (sql: string): Promise<unknown[]> => {
		options.queries?.push([sql]);
		return [];
	});
	const repos = new Map<unknown, unknown>([
		[MediaItem, { findOne: vi.fn(async () => options.item ?? null) }],
		[UserPreference, { findOne: vi.fn(async () => (options.visibility ? { profileVisibility: options.visibility } : null)) }],
	]);
	const source = { query, getRepository: (entity: unknown) => repos.get(entity) ?? {} } as unknown as DataSource;
	return { source, query };

}

describe("social helpers", () => {
	it("escapes LIKE wildcards so searches match literally", () => {
		expect(likePattern("50%_off")).toBe("%50\\%\\_off%");
	});

	it("counts reports as fresh for three minutes", () => {
		const now = Date.now();
		expect(isFresh(now - PRESENCE_MS + 1000, now)).toBe(true);
		expect(isFresh(now - PRESENCE_MS - 1000, now)).toBe(false);
	});

	it("picks the first downloaded image of the preferred types", () => {
		const images = [
			{ type: "backdrop", path: "" },
			{ type: "backdrop", path: "b.jpg" },
			{ type: "poster", path: "p.jpg" },
		];
		expect(imageIndexOf(images, ["poster", "backdrop"])).toBe(2);
		expect(imageIndexOf(images, ["thumb"])).toBeNull();
	});

	it("reads artist and duration from metadata", () => {
		const item = {
			metadata: { albumArtist: " Coldplay " },
			technical: { duration: 214.6 },
		} as unknown as MediaItem;
		expect(artistOf(item)).toBe("Coldplay");
		expect(durationOf(item)).toBe(215);
	});
});

describe("FavoritesService", () => {
	it("refuses seasons and other types that cannot be favourited", async () => {
		const { source } = dataSource({ item: { id: TRACK, type: "season" } });
		await expect(new FavoritesService(source).add(USER, TRACK)).rejects.toThrow(/cannot be favourited/);
	});

	it("reports a missing item as not found", async () => {
		const { source } = dataSource({ item: null });
		await expect(new FavoritesService(source).add(USER, TRACK)).rejects.toThrow(/not found/i);
	});
});

describe("ProfilesService listening", () => {
	function setup(item: Partial<MediaItem> | null = { id: TRACK, type: "track" }) {

		const { source, query } = dataSource({ item });
		const service = new ProfilesService(source, {} as FavoritesService, {} as PlaylistsService, {} as FriendsService);
		return { service, query };

	}

	it("counts a play once while the same song keeps reporting", async () => {
		const { service, query } = setup();
		await service.reportListening(USER, TRACK, "playing");
		await service.reportListening(USER, TRACK, "playing");
		expect(query).toHaveBeenCalledTimes(1);
	});

	it("counts a play again after the song was stopped", async () => {
		const { service, query } = setup();
		await service.reportListening(USER, TRACK, "playing");
		await service.reportListening(USER, TRACK, "stopped");
		await service.reportListening(USER, TRACK, "playing");
		expect(query).toHaveBeenCalledTimes(2);
	});

	it("allows a failed listening write to be retried", async () => {
		const { service, query } = setup();
		query.mockRejectedValueOnce(new Error("database unavailable"));
		await expect(service.reportListening(USER, TRACK, "playing")).rejects.toThrow("database unavailable");
		await service.reportListening(USER, TRACK, "playing");
		expect(query).toHaveBeenCalledTimes(2);
	});

	it("keeps users separate and rejects anything that is not a song", async () => {
		const { service, query } = setup();
		await service.reportListening(USER, TRACK, "playing");
		await service.reportListening(OTHER, TRACK, "playing");
		expect(query).toHaveBeenCalledTimes(2);
		await expect(setup({ id: TRACK, type: "movie" }).service.reportListening(USER, TRACK, "playing")).rejects.toThrow(/not found/i);
	});

	it("hides a hidden profile from everyone but its owner", async () => {
		const { source } = dataSource();
		const row = {
			id: OTHER,
			username: "sam",
			display_name: null,
			created_at: new Date(),
			avatar_file: null,
			visibility: "hidden" as const,
		};
		(source.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([row]);
		const service = new ProfilesService(source, {} as FavoritesService, {} as PlaylistsService, {} as FriendsService);
		await expect(service.profile(USER, "sam")).rejects.toThrow(/not found/i);
	});
});

describe("PlaylistsService.addTrack with albums", () => {
	const PLAYLIST = "44444444-4444-4444-8444-444444444444";
	const T1 = "55555555-5555-4555-8555-555555555551";
	const T2 = "55555555-5555-4555-8555-555555555552";

	function setup(type: string, albumTracks: string[], existing: string[]) {

		const inserts: unknown[][] = [];
		const manager = {
			findOne: vi.fn(async () => ({ id: PLAYLIST })),
			find: vi.fn(async (entity: unknown) => (entity === MediaItem ? albumTracks.map((id) => ({ id })) : existing.map((itemId) => ({ itemId })))),
			update: vi.fn(async () => ({})),
			query: vi.fn(async (sql: string, params: unknown[] = []): Promise<unknown[]> => {
				if (sql.includes("COUNT(*)")) return [{ count: existing.length, next: existing.length }];
				if (sql.startsWith("INSERT")) inserts.push(params);
				return [];
			}),
		};
		const repos = new Map<unknown, unknown>([
			[MediaItem, { findOne: vi.fn(async () => ({ id: TRACK, type })) }],
			[Playlist, { findOneBy: vi.fn(async () => ({ id: PLAYLIST, userId: USER })) }],
		]);
		const source = {
			getRepository: (entity: unknown) => repos.get(entity) ?? {},
			transaction: async (work: (m: typeof manager) => unknown) => work(manager),
		} as unknown as DataSource;
		return { service: new PlaylistsService(source), inserts };

	}

	it("adds every song of an album in order and skips ones already present", async () => {
		const { service, inserts } = setup("album", [T1, T2], [T1]);
		expect(await service.addTrack(USER, PLAYLIST, TRACK)).toEqual({ added: 1 });
		expect(inserts[0]).toEqual([PLAYLIST, [T2], 1]);
	});

	it("rejects an album without songs and items that are neither songs nor albums", async () => {
		await expect(setup("album", [], []).service.addTrack(USER, PLAYLIST, TRACK)).rejects.toThrow(/no songs/);
		await expect(setup("movie", [], []).service.addTrack(USER, PLAYLIST, TRACK)).rejects.toThrow(/songs and albums/);
	});
});
