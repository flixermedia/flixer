import { describe, expect, it } from "vitest";
import { channelNameMatchScore, groupRegionalChannels, stableChannelId } from "./guideMatching.js";
import type { RegionalGuideChannel } from "./guideMatching.js";

const listing = (title: string, start: number, stop: number) => ({
	channelExternalId: "channel",
	title,
	start,
	stop,
	subtitle: null,
	description: null,
	category: null,
});

describe("guide channel matching", () => {
	it("uses a stable channel ID for each source and external ID", () => {
		expect(stableChannelId("source", "channel")).toBe(stableChannelId("source", "channel"));
		expect(stableChannelId("source", "channel")).not.toBe(stableChannelId("other", "channel"));
	});

	it("recognizes regional IPTV name variants", () => {
		expect(channelNameMatchScore("BBC One London", "BBC One HD", "bbc.one", "bbc.one.london")).toBe(1);
	});

	it("groups channels only when matching episode titles and exact start/stop times meet the threshold", () => {
		const channels: RegionalGuideChannel[] = [
			{
				id: "one",
				name: "BBC One London",
				icon: null,
				sortOrder: 0,
				iptvChannelId: null,
				programmes: [listing("News", 0, 60), listing("Show", 60, 120), listing("Film", 120, 180)],
			},
			{
				id: "two",
				name: "BBC One Scotland",
				icon: null,
				sortOrder: 1,
				iptvChannelId: null,
				programmes: [listing("News", 0, 60), listing("Show", 60, 120), listing("Local News", 120, 180)],
			},
			{
				id: "three",
				name: "Different channel",
				icon: null,
				sortOrder: 2,
				iptvChannelId: null,
				programmes: [listing("Other", 0, 60), listing("Show", 60, 121), listing("Film", 121, 180)],
			},
			{
				id: "radio-fm",
				name: "BBC Radio 4 FM",
				icon: null,
				sortOrder: 3,
				iptvChannelId: null,
				programmes: [listing("Radio Programme", 0, 60), listing("Another Show", 60, 120)],
			},
			{
				id: "radio-lw",
				name: "BBC Radio 4 LW",
				icon: null,
				sortOrder: 4,
				iptvChannelId: null,
				programmes: [listing("Radio Programme", 0, 60), listing("Another Show", 60, 120)],
			},
		];
		const groups = groupRegionalChannels(channels, 65);
		expect(groups.map(({ primary, variants }) => [primary.id, variants.map(({ id }) => id)])).toEqual([
			["one", ["two"]],
			["three", []],
			["radio-fm", []],
			["radio-lw", []],
		]);
	});
});
