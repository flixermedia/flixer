import { createDecipheriv, createHash, createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DataSource } from "typeorm";
import { AppConfig, setAppConfig } from "../../config/store/appConfig.js";
import type { MediaItem } from "../../entities/mediaItem.entity.js";
import type { AuthService } from "../auth/authService.js";
import type { MediaLibrariesService } from "../mediaLibraries/mediaLibrariesService.js";
import type { MediaRootsService } from "../mediaLibraries/mediaRootsService.js";
import type { MediaSegmentsService } from "../media/mediaSegmentsService.js";
import type { GuideService } from "../guide/guideService.js";
import type { MediaAccessService } from "../access/mediaAccessService.js";
import type { EntitlementService } from "../payments/entitlementService.js";
import { PlaybackService } from "./playbackService.js";

describe("cached trailer playback", () => {
	afterEach(() => {
		setAppConfig(undefined);
		vi.unstubAllEnvs();
	});

	it("issues a signed, encrypted streamer locator scoped to the trailer root and viewer", async () => {
		const secret = "trailer-test-secret-not-for-production";
		vi.stubEnv("APP_SECRET", secret);
		setAppConfig(new AppConfig(null));
		const dataSource = { getRepository: () => ({ findOneBy: vi.fn().mockResolvedValue({ originalAccess: "allow" }) }) } as unknown as DataSource;
		const service = new PlaybackService({} as AuthService, {} as MediaLibrariesService, {} as MediaRootsService, {} as MediaSegmentsService, dataSource, {} as GuideService, {} as MediaAccessService, {} as EntitlementService);
		const info = await service.issueTrailer("viewer", { id: "item", title: "Movie" } as MediaItem, "item-42.mp4");
		const token = info.mediaSource.streamUrl.split("/").at(-1)!;
		const [header, payload, signature] = token.split(".");
		expect(signature).toBe(createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url"));
		const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
		expect(claims.sub).toBe("viewer");
		expect(claims.mediaItemId).toBe("item");
		const encoded = Buffer.from(claims.mediaLocator, "base64url");
		const context = "flixer-streamer:media-locator:v1";
		const key = createHash("sha256")
			.update(Buffer.concat([Buffer.from(`${context}\0`), Buffer.from(secret)]))
			.digest();
		const decipher = createDecipheriv("aes-256-gcm", key, encoded.subarray(0, 12));
		decipher.setAAD(Buffer.from(context));
		decipher.setAuthTag(encoded.subarray(-16));
		const locator = Buffer.concat([decipher.update(encoded.subarray(12, -16)), decipher.final()]);
		expect(JSON.parse(locator.toString("utf8"))).toEqual({ rootId: "flixer-trailers", relativePath: "item-42.mp4" });
	});

	it("signs and encrypts remote trailer locators for the requesting viewer", () => {
		const secret = "trailer-test-secret-not-for-production";
		vi.stubEnv("APP_SECRET", secret);
		setAppConfig(new AppConfig(null));
		const service = new PlaybackService({} as AuthService, {} as MediaLibrariesService, {} as MediaRootsService, {} as MediaSegmentsService, {} as DataSource, {} as GuideService, {} as MediaAccessService, {} as EntitlementService);
		const url = "https://r1.googlevideo.com/video?signature=test";
		const stream = service.issueRemoteTrailer("viewer", { id: "item", title: "Movie" } as MediaItem, url);
		expect(stream).toContain("/streamer/trailer/");
		const [header, payload, signature] = stream.split("/").at(-1)!.split(".");
		expect(signature).toBe(createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url"));
		const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
		expect(claims.sub).toBe("viewer");
		expect(claims.mediaItemId).toBe("item");
		const encoded = Buffer.from(claims.mediaLocator, "base64url");
		const context = "flixer-streamer:media-locator:v1";
		const key = createHash("sha256").update(Buffer.concat([Buffer.from(`${context}\0`), Buffer.from(secret)])).digest();
		const decipher = createDecipheriv("aes-256-gcm", key, encoded.subarray(0, 12));
		decipher.setAAD(Buffer.from(context));
		decipher.setAuthTag(encoded.subarray(-16));
		expect(JSON.parse(Buffer.concat([decipher.update(encoded.subarray(12, -16)), decipher.final()]).toString("utf8"))).toEqual({ type: "trailer", url });
	});
});
