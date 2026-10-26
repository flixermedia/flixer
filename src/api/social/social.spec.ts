import { describe, expect, it, vi } from "vitest";
import type { DataSource } from "typeorm";
import { MediaItem } from "../../entities/mediaItem.entity.js";
import { Playlist } from "../../entities/playlist.entity.js";
import { FavoritesService } from "./favoritesService.js";
import { PlaylistsService } from "./playlistsService.js";
import { ProfilesService, isFresh, likePattern, PRESENCE_MS } from "./profilesService.js";
import { artistOf, durationOf, imageIndexOf } from "./socialItems.js";

const USER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const TRACK = "33333333-3333-4333-8333-333333333333";

function dataSource(options: { item?: Partial<MediaItem> | null; queries?: Array<unknown[]> } = {}) {
	const query = vi.fn(async (sql: string): Promise<unknown[]> => {
		options.queries?.push([sql]);
		return [];
	});
	const repos = new Map<unknown, unknown>([[MediaItem, { findOne: vi.fn(async () => options.item ?? null) }]]);
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
		const images = [{ type: "backdrop", path: "" }, { type: "backdrop", path: "b.jpg" }, { type: "poster", path: "p.jpg" }];
		expect(imageIndexOf(images, ["poster", "backdrop"])).toBe(2);
		expect(imageIndexOf(images, ["thumb"])).toBeNull();
	});

	it("reads artist and duration from metadata", () => {
		const item = { metadata: { albumArtist: " Coldplay " }, technical: { duration: 214.6 } } as unknown as MediaItem;
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
		const service = new ProfilesService(source, {} as FavoritesService, {} as PlaylistsService);
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

	it("keeps users separate and rejects anything that is not a song", async () => {
		const { service, query } = setup();
		await service.reportListening(USER, TRACK, "playing");
		await service.reportListening(OTHER, TRACK, "playing");
		expect(query).toHaveBeenCalledTimes(2);
		await expect(setup({ id: TRACK, type: "movie" }).service.reportListening(USER, TRACK, "playing")).rejects.toThrow(/not found/i);
	});

	it("hides a hidden profile from everyone but its owner", async () => {
		const { source } = dataSource();
		const row = { id: OTHER, username: "sam", display_name: null, created_at: new Date(), avatar_file: null, hidden: true };
		(source.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([row]);
		const service = new ProfilesService(source, {} as FavoritesService, {} as PlaylistsService);
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
			query: vi.fn(async (sql: string, params: unknown[] = []): Promise<unknown[]> => {
				if (sql.includes("FROM media_items")) return albumTracks.map((id) => ({ id }));
				if (sql.includes("COUNT(*)")) return [{ count: existing.length, next: existing.length }];
				if (sql.includes("SELECT item_id")) return existing.map((item_id) => ({ item_id }));
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
