import { createHash } from "node:crypto";
import type { GuideProgrammeCache } from "../../entities/guideSource.entity.js";

const REGION_WORDS = new Set([
	"england",
	"london",
	"scotland",
	"wales",
	"northern",
	"ireland",
	"north",
	"northwest",
	"northeast",
	"midlands",
	"east",
	"west",
	"south",
	"southeast",
	"southwest",
	"hd",
	"uk",
	"ci",
	"ni",
	"roi",
	"yorks",
	"lincs",
	"meridian",
	"anglia",
	"granada",
	"central",
	"tyne",
	"tees",
	"border",
	"westcountry",
]);

export interface RegionalGuideChannel {
	id: string;
	sourceId?: string;
	externalId?: string;
	name: string;
	icon: string | null;
	sortOrder: number;
	iptvChannelId: string | null;
	programmes: GuideProgrammeCache[];
}

export interface RegionalGuideGroup {
	primary: RegionalGuideChannel;
	variants: RegionalGuideChannel[];
}

export function stableChannelId(sourceId: string, externalId: string): string {
	const bytes = createHash("sha256").update(`${sourceId}\0${externalId}`).digest().subarray(0, 16);
	bytes[6] = (bytes[6] & 0x0f) | 0x50;
	bytes[8] = (bytes[8] & 0x3f) | 0x80;
	const hex = bytes.toString("hex");
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function normalizedName(value: string): string {
	return value
		.normalize("NFKD")
		.replace(/\p{Diacritic}/gu, "")
		.toLowerCase()
		.replace(/\+/g, " plus ")
		.replace(/[^a-z0-9]+/g, " ")
		.trim()
		.split(/\s+/)
		.filter((word) => word && !REGION_WORDS.has(word))
		.join(" ");
}

export function channelNameMatchScore(
	epgName: string,
	iptvName: string,
	tvgId: string | null,
	epgExternalId: string,
): number {
	const epgId = normalizedName(epgExternalId);
	const normalizedTvgId = tvgId ? normalizedName(tvgId) : "";
	if (normalizedTvgId && epgId && normalizedTvgId === epgId) return 1;
	const left = normalizedName(epgName);
	const right = normalizedName(iptvName);
	if (!left || !right) return 0;
	if (left === right) return 1;
	const leftWords = new Set(left.split(" "));
	const rightWords = new Set(right.split(" "));
	const overlap = [...leftWords].filter((word) => rightWords.has(word)).length;
	return overlap / Math.max(leftWords.size, rightWords.size);
}

function programmeKey(programme: GuideProgrammeCache): string {
	const title = normalizedName(programme.title);
	return `${programme.start}:${programme.stop}:${title}`;
}

export function groupRegionalChannels(
	channels: RegionalGuideChannel[],
	thresholdPercent: number,
): RegionalGuideGroup[] {
	const ordered = [...channels].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
	const parents = new Map(ordered.map((channel) => [channel.id, channel.id]));
	const channelsById = new Map(ordered.map((channel) => [channel.id, channel]));
	const scheduleKeys = new Map(ordered.map((channel) => [channel.id, new Set(channel.programmes.map(programmeKey))]));
	const countsByKey = new Map<string, string[]>();
	for (const channel of ordered) {
		for (const key of scheduleKeys.get(channel.id) ?? []) {
			const ids = countsByKey.get(key) ?? [];
			ids.push(channel.id);
			countsByKey.set(key, ids);
		}
	}

	const matchedCounts = new Map<string, number>();
	for (const ids of countsByKey.values()) {
		for (let left = 0; left < ids.length; left += 1) {
			for (let right = left + 1; right < ids.length; right += 1) {
				const pair = [ids[left], ids[right]].sort().join(":");
				matchedCounts.set(pair, (matchedCounts.get(pair) ?? 0) + 1);
			}
		}
	}

	const find = (id: string): string => {
		const parent = parents.get(id);
		if (!parent || parent === id) return id;
		const root = find(parent);
		parents.set(id, root);
		return root;
	};
	const threshold = thresholdPercent / 100;
	for (const [pair, matched] of matchedCounts) {
		const [leftId, rightId] = pair.split(":");
		const leftChannel = channelsById.get(leftId);
		const rightChannel = channelsById.get(rightId);
		if (!leftChannel || !rightChannel || normalizedName(leftChannel.name) !== normalizedName(rightChannel.name))
			continue;
		const leftCount = scheduleKeys.get(leftId)?.size ?? 0;
		const rightCount = scheduleKeys.get(rightId)?.size ?? 0;
		const smallerScheduleCount = Math.min(leftCount, rightCount);
		if (smallerScheduleCount === 0 || matched / smallerScheduleCount < threshold) continue;
		const leftRoot = find(leftId);
		const rightRoot = find(rightId);
		if (leftRoot !== rightRoot) parents.set(rightRoot, leftRoot);
	}

	const groups = new Map<string, RegionalGuideChannel[]>();
	for (const channel of ordered) {
		const root = find(channel.id);
		const group = groups.get(root) ?? [];
		group.push(channel);
		groups.set(root, group);
	}
	return [...groups.values()].map((members) => ({
		primary: members[0],
		variants: members.slice(1),
	}));
}
