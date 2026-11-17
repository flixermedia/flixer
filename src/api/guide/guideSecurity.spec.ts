import { describe, expect, it } from "vitest";
import { isGlobalAddress, liveStreamContainer, parseSourceUrl } from "./guideService.js";

describe("guide source network restrictions", () => {
	it("allows public addresses", () => {
		expect(isGlobalAddress("8.8.8.8")).toBe(true);
		expect(isGlobalAddress("2606:4700:4700::1111")).toBe(true);
	});

	it("rejects private, loopback and link-local addresses", () => {
		expect(isGlobalAddress("127.0.0.1")).toBe(false);
		expect(isGlobalAddress("10.0.0.1")).toBe(false);
		expect(isGlobalAddress("169.254.169.254")).toBe(false);
		expect(isGlobalAddress("::1")).toBe(false);
		expect(isGlobalAddress("::ffff:192.168.1.1")).toBe(false);
	});

	it("recognizes supported HLS and DASH manifest URLs", () => {
		expect(liveStreamContainer("https://cdn.example/live/index.m3u8?token=abc")).toBe("m3u8");
		expect(liveStreamContainer("https://cdn.example/live/manifest.MPD?token=abc")).toBe("mpd");
		expect(liveStreamContainer("https://cdn.example/live/segment.m4s")).toBeNull();
		expect(liveStreamContainer("file:///live/manifest.mpd")).toBeNull();
	});

	it("checks IPTV URL safety without requiring hostname DNS resolution", () => {
		expect(parseSourceUrl("https://unresolved-stream.example/live/channel.m3u8", true).hostname).toBe(
			"unresolved-stream.example",
		);
		expect(() => parseSourceUrl("http://127.0.0.1/live/channel.m3u8", true)).toThrow(
			"Source URLs cannot point to private or reserved IP addresses.",
		);
		expect(() => parseSourceUrl("https://stream.local/live/channel.m3u8", true)).toThrow(
			"Source URLs must use a public HTTP(S) host without credentials or a custom port.",
		);
	});
});
