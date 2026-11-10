import { createDecipheriv, createHash, createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppConfig, setAppConfig } from "../../config/store/appConfig.js";
import { Advertisement } from "../../entities/advertisement.entity.js";
import { AdvertisementSettings } from "../../entities/advertisementSettings.entity.js";
import { MediaItem } from "../../entities/mediaItem.entity.js";
import { User } from "../../entities/user.entity.js";
import { PlaybackService } from "./playbackService.js";

const secret = "advertisement-test-secret-not-for-production";

function setup(enabled = true, exempt = false, type = "movie") {
	vi.stubEnv("APP_SECRET", secret);
	setAppConfig(new AppConfig(null));
	const item = { id: "movie", title: "Movie", type, rootId: "movies", relativePath: "movie.mp4", isPlaceholder: false };
	const settings = { enabled, minimumIntervalSeconds: 300, maxPerPlayback: 5 };
	const ad = { id: "ad", name: "Example", filename: "ad.mp4", enabled: true, targetUrl: "https://example.com/", preroll: true, midrollSeconds: [300], scopes: [{ type: "all", ref: null }], skipAfterSeconds: 5 };
	const source = {
		getRepository: (entity: unknown) => {
			if (entity === MediaItem) return { findOneBy: vi.fn().mockResolvedValue(item) };
			if (entity === User) return { findOneByOrFail: vi.fn().mockResolvedValue({ id: "viewer" }), findOneBy: vi.fn().mockResolvedValue({ originalAccess: "allow" }) };
			if (entity === AdvertisementSettings) return { findOneByOrFail: vi.fn().mockResolvedValue(settings) };
			if (entity === Advertisement) return { findBy: vi.fn().mockResolvedValue([ad]) };
			throw new Error("Unexpected repository");
		},
	};
	const access = { resolve: vi.fn().mockResolvedValue({ userId: "viewer" }), assertPlayable: vi.fn().mockResolvedValue(undefined) };
	const entitlements = { contextFor: vi.fn().mockResolvedValue({ ids: ["movie"], kind: "movies", artists: [] }), assertCanPlay: vi.fn().mockResolvedValue(undefined), isAdExempt: vi.fn().mockResolvedValue(exempt) };
	const segments = { forItem: vi.fn().mockResolvedValue({ chapters: [], segments: [] }) };
	const service = new PlaybackService({} as never, {} as never, {} as never, segments as never, source as never, {} as never, access as never, entitlements as never);
	return { service, entitlements };
}

afterEach(() => {
	setAppConfig(undefined);
	vi.unstubAllEnvs();
});

describe("advertisements in item playback", () => {
	it("issues signed viewer-specific ad URLs for eligible pre-roll and mid-roll", async () => {
		const { service } = setup();
		const result = await service.createItemPlaybackInfo("movie");
		expect(result.itemType).toBe("movie");
		expect(result.advertisements.map((ad) => ad.atSeconds)).toEqual([0, 300]);
		const [header, payload, signature] = result.advertisements[0].streamUrl.split("/").at(-1)!.split(".");
		expect(signature).toBe(createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url"));
		const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
		expect(claims.sub).toBe("viewer");
		expect(claims.direct).toBe(true);
		expect(claims.exp - claims.iat).toBe(3600);
		const encoded = Buffer.from(claims.mediaLocator, "base64url");
		const context = "flixer-streamer:media-locator:v1";
		const key = createHash("sha256").update(Buffer.concat([Buffer.from(`${context}\0`), Buffer.from(secret)])).digest();
		const decipher = createDecipheriv("aes-256-gcm", key, encoded.subarray(0, 12));
		decipher.setAAD(Buffer.from(context));
		decipher.setAuthTag(encoded.subarray(-16));
		expect(JSON.parse(Buffer.concat([decipher.update(encoded.subarray(12, -16)), decipher.final()]).toString("utf8"))).toEqual({ rootId: "flixer-advertisements", relativePath: "ad.mp4" });
	});

	it("returns no ads when disabled, exempt, or playing an audio track", async () => {
		expect((await setup(false).service.createItemPlaybackInfo("movie")).advertisements).toEqual([]);
		expect((await setup(true, true).service.createItemPlaybackInfo("movie")).advertisements).toEqual([]);
		expect((await setup(true, false, "track").service.createItemPlaybackInfo("movie")).advertisements).toEqual([]);
	});
});
