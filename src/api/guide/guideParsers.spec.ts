import { describe, expect, it } from "vitest";
import { parseM3u, parseXmltv } from "./guideParsers.js";

describe("guide parsers", () => {
	it("parses XMLTV channels, programme times and escaped text", () => {
		const result = parseXmltv(`
			<tv>
				<channel id="bbc-one-london"><display-name>BBC One &amp; London</display-name><icon src="https://example.com/logo.png"/></channel>
				<programme channel="bbc-one-london" start="20261031190000 +0000" stop="20261031200000 +0000">
					<title>Evening News</title><sub-title><![CDATA[Regional edition]]></sub-title><desc>News &amp; weather</desc><category>News</category>
				</programme>
			</tv>
		`);
		expect(result.channels).toEqual([
			{ externalId: "bbc-one-london", name: "BBC One & London", icon: "https://example.com/logo.png" },
		]);
		expect(result.programmes).toEqual([
			{
				channelExternalId: "bbc-one-london",
				start: Date.UTC(2026, 9, 31, 19),
				stop: Date.UTC(2026, 9, 31, 20),
				title: "Evening News",
				subtitle: "Regional edition",
				description: "News & weather",
				category: "News",
			},
		]);
	});

	it("rejects XMLTV documents with custom entity declarations", () => {
		expect(() => parseXmltv("<!DOCTYPE tv [<!ENTITY x SYSTEM 'file:///etc/passwd'>]><tv/>")).toThrow(
			/cannot declare/,
		);
	});

	it("parses extended M3U metadata and channel URLs", () => {
		expect(
			parseM3u(`#EXTM3U
#EXTINF:-1 tvg-id="bbc.one" tvg-name="BBC One" tvg-logo="https://example.com/bbc.png" group-title="UK",BBC One HD
https://stream.example.com/bbc-one/index.m3u8`),
		).toEqual([
			{
				externalId: JSON.stringify(["bbc.one", "BBC One HD", "UK", 0]),
				tvgId: "bbc.one",
				name: "BBC One HD",
				icon: "https://example.com/bbc.png",
				group: "UK",
				url: "https://stream.example.com/bbc-one/index.m3u8",
			},
		]);
	});
});
