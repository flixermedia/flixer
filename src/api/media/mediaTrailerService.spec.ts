import { describe, expect, it, vi } from "vitest";
import type { DataSource } from "typeorm";
import type { MediaAccessService } from "../access/mediaAccessService.js";
import type { ExternalMetadataService } from "../requests/externalMetadataService.js";
import type { TrailerCacheService } from "./trailerCacheService.js";
import type { PlaybackService } from "../playback/playbackService.js";
import type { AuthService } from "../auth/authService.js";
import { Setting } from "../../entities/setting.entity.js";
import { MediaTrailerService } from "./mediaTrailerService.js";

describe("MediaTrailerService", () => {
	function setup(item: unknown, visible = true, enabled = false) {
		const findOneBy = vi.fn().mockResolvedValue(item);
		const dataSource = { getRepository: (type: unknown) => type === Setting ? { findOneBy: vi.fn().mockResolvedValue({ value: enabled }) } : { findOneBy } } as unknown as DataSource;
		const access = { resolve: vi.fn().mockResolvedValue({ userId: "user" }), isVisible: vi.fn().mockResolvedValue(visible) } as unknown as MediaAccessService;
		const metadata = { trailer: vi.fn().mockResolvedValue({ key: "abcdefghijk", name: "Official trailer" }) } as unknown as ExternalMetadataService;
		const cache = { find: vi.fn().mockResolvedValue(null), download: vi.fn().mockResolvedValue(undefined), remove: vi.fn().mockResolvedValue(undefined), remoteUrl: vi.fn().mockResolvedValue("https://x.googlevideo.com/video"), queue: vi.fn() } as unknown as TrailerCacheService;
		const playback = { issueTrailer: vi.fn().mockResolvedValue({ mediaSource: { streamUrl: "/streamer/stream/token" } }), issueRemoteTrailer: vi.fn().mockReturnValue("/streamer/trailer/token") } as unknown as PlaybackService;
		const auth = { requireAdmin: vi.fn().mockResolvedValue({}) } as unknown as AuthService;
		return { service: new MediaTrailerService(dataSource, access, metadata, cache, playback, auth), access, metadata, cache, playback, auth };
	}

	it.each([
		["movie", "movie"],
		["series", "tv"],
	])("resolves %s trailers via TMDB %s", async (type, providerType) => {
		const { service, metadata } = setup({ type, providerIds: { tmdb: "42" }, isPlaceholder: false });
		await expect(service.trailer("item", "Bearer token")).resolves.toEqual({ key: null, name: "Official trailer", streamUrl: "/streamer/trailer/token" });
		expect(metadata.trailer).toHaveBeenCalledWith(providerType, "42");
	});

	it("does not reveal or look up trailers for restricted titles", async () => {
		const { service, metadata } = setup({ type: "movie", providerIds: { tmdb: "42" }, isPlaceholder: false }, false);
		await expect(service.trailer("item")).rejects.toThrow("Media item not found.");
		expect(metadata.trailer).not.toHaveBeenCalled();
	});

	it.each([
		{ type: "episode", providerIds: { tmdb: "42" } },
		{ type: "movie", providerIds: {} },
		{ type: "movie", providerIds: { tmdb: "../42" } },
	])("does not query TMDB for unsupported or unidentified media", async (item) => {
		const { service, metadata } = setup(item);
		await expect(service.trailer("item")).resolves.toBeNull();
		expect(metadata.trailer).not.toHaveBeenCalled();
	});

	it("plays a cached trailer without contacting TMDB", async () => {
		const item = { id: "item", type: "movie", title: "Movie", providerIds: { tmdb: "42" } };
		const { service, cache, metadata, playback } = setup(item, true, true);
		vi.mocked(cache.find).mockResolvedValue("item-42.mp4");
		await expect(service.trailer("item")).resolves.toEqual({ key: null, name: "Movie", streamUrl: "/streamer/stream/token" });
		expect(playback.issueTrailer).toHaveBeenCalledWith("user", item, "item-42.mp4");
		expect(metadata.trailer).not.toHaveBeenCalled();
	});

	it("starts a background download only when the admin enables caching", async () => {
		const item = { id: "item", type: "movie", providerIds: { tmdb: "42" } };
		const disabled = setup(item);
		await disabled.service.trailer("item");
		expect(disabled.cache.find).not.toHaveBeenCalled();
		expect(disabled.cache.queue).not.toHaveBeenCalled();
		const enabled = setup(item, true, true);
		await enabled.service.trailer("item");
		expect(enabled.cache.queue).toHaveBeenCalledWith("item", "42", "abcdefghijk");
		expect(enabled.playback.issueRemoteTrailer).toHaveBeenCalledWith("user", item, "https://x.googlevideo.com/video");
	});

	it("requires an admin before starting or removing a cache", async () => {
		const { service, auth, cache } = setup({ id: "item", type: "series", providerIds: { tmdb: "42" } });
		vi.mocked(auth.requireAdmin).mockRejectedValue(new Error("Admin required"));
		await expect(service.cacheTrailer("item")).rejects.toThrow("Admin required");
		await expect(service.removeTrailer("item")).rejects.toThrow("Admin required");
		expect(cache.download).not.toHaveBeenCalled();
		expect(cache.remove).not.toHaveBeenCalled();
	});

	it("only downloads on explicit admin request", async () => {
		const { service, metadata, cache } = setup({ id: "item", type: "series", providerIds: { tmdb: "42" } });
		await service.cacheTrailer("item");
		expect(metadata.trailer).toHaveBeenCalledWith("tv", "42");
		expect(cache.download).toHaveBeenCalledWith("item", "42", "abcdefghijk");
		await service.removeTrailer("item");
		expect(cache.remove).toHaveBeenCalledWith("item", "42");
	});
});
