import type { GuideChannelCache, GuideProgrammeCache, IptvChannelCache } from "../../entities/guideSource.entity.js";

function decodeXml(value: string): string {
	return value
		.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
		.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (match, entity: string) => {
			const name = entity.toLowerCase();
			if (name === "amp") return "&";
			if (name === "lt") return "<";
			if (name === "gt") return ">";
			if (name === "quot") return '"';
			if (name === "apos") return "'";
			const codePoint = name.startsWith("#x")
				? Number.parseInt(name.slice(2), 16)
				: Number.parseInt(name.slice(1), 10);
			return Number.isFinite(codePoint) && codePoint > 0 && codePoint <= 0x10ffff
				? String.fromCodePoint(codePoint)
				: match;
		})
		.replace(/<[^>]*>/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

function attribute(attributes: string, name: string): string | null {
	const match = attributes.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*(["'])(.*?)\\1`, "i"));
	return match ? decodeXml(match[2]) : null;
}

function textTag(xml: string, name: string): string | null {
	const match = xml.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}\\s*>`, "i"));
	const value = match ? decodeXml(match[1]) : "";
	return value || null;
}

function parseXmltvDate(value: string | null): number | null {
	if (!value) return null;
	const match = value.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(?:\s*([+-])(\d{2})(\d{2}))?$/);
	if (!match) return null;
	const [, year, month, day, hour, minute, second, sign, offsetHour, offsetMinute] = match;
	const utc = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second));
	const offset = sign ? (Number(offsetHour) * 60 + Number(offsetMinute)) * (sign === "+" ? 1 : -1) : 0;
	return utc - offset * 60_000;
}

export function parseXmltv(xml: string): { channels: GuideChannelCache[]; programmes: GuideProgrammeCache[] } {
	if (/<!DOCTYPE|<!ENTITY/i.test(xml)) {
		throw new Error("XMLTV feeds cannot declare document types or custom entities.");
	}

	const channels: GuideChannelCache[] = [];
	for (const [, attributes, body] of xml.matchAll(/<channel\b([^>]*)>([\s\S]*?)<\/channel\s*>/gi)) {
		const externalId = attribute(attributes, "id");
		const name = textTag(body, "display-name");
		if (!externalId || !name) continue;
		const icon = body.match(/<icon\b([^>]*)\/?\s*>/i)?.[1];
		channels.push({ externalId, name, icon: icon ? attribute(icon, "src") : null });
	}

	const programmes: GuideProgrammeCache[] = [];
	for (const [, attributes, body] of xml.matchAll(/<programme\b([^>]*)>([\s\S]*?)<\/programme\s*>/gi)) {
		const channelExternalId = attribute(attributes, "channel");
		const start = parseXmltvDate(attribute(attributes, "start"));
		const stop = parseXmltvDate(attribute(attributes, "stop"));
		const title = textTag(body, "title");
		if (!channelExternalId || start === null || stop === null || stop <= start || !title) continue;
		programmes.push({
			channelExternalId,
			start,
			stop,
			title,
			subtitle: textTag(body, "sub-title"),
			description: textTag(body, "desc"),
			category: textTag(body, "category"),
		});
	}

	if (channels.length === 0) {
		throw new Error("The XMLTV feed did not contain any valid channels.");
	}
	return { channels, programmes };
}

function m3uAttributes(value: string): Record<string, string> {
	const attributes: Record<string, string> = {};
	const expression = /([\w-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s,]+))/g;
	for (const match of value.matchAll(expression)) {
		attributes[match[1].toLowerCase()] = match[3] ?? match[4] ?? match[5] ?? "";
	}
	return attributes;
}

function extinfCommaIndex(value: string): number {
	let quote: string | null = null;
	for (let index = 0; index < value.length; index += 1) {
		const character = value[index];
		if (quote) {
			if (character === quote) quote = null;
		} else if (character === '"' || character === "'") {
			quote = character;
		} else if (character === ",") {
			return index;
		}
	}
	return -1;
}

export function parseM3u(playlist: string): IptvChannelCache[] {
	const lines = playlist.replace(/^\uFEFF/, "").split(/\r?\n/);
	if (!lines.some((line) => line.trim().startsWith("#EXTM3U"))) {
		throw new Error("The IPTV source is not an extended M3U playlist.");
	}

	const channels: IptvChannelCache[] = [];
	const occurrences = new Map<string, number>();
	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index].trim();
		if (!line.startsWith("#EXTINF:")) continue;
		const comma = extinfCommaIndex(line);
		const metadata = comma < 0 ? line.slice(8) : line.slice(8, comma);
		const attributes = m3uAttributes(metadata);
		const name = (comma < 0 ? "" : line.slice(comma + 1)).trim() || attributes["tvg-name"];
		let url: string | undefined;
		while (++index < lines.length) {
			const candidate = lines[index].trim();
			if (candidate && !candidate.startsWith("#")) {
				url = candidate;
				break;
			}
		}
		if (!name || !url) continue;
		const tvgId = attributes["tvg-id"] || "";
		const group = attributes["group-title"] || "";
		const identity = JSON.stringify([tvgId, name, group]);
		const occurrence = occurrences.get(identity) ?? 0;
		occurrences.set(identity, occurrence + 1);
		channels.push({
			externalId: JSON.stringify([tvgId, name, group, occurrence]),
			tvgId: tvgId || null,
			name,
			icon: attributes["tvg-logo"] || null,
			group: group || null,
			url,
		});
	}
	if (channels.length === 0) {
		throw new Error("The IPTV playlist did not contain any playable channels.");
	}
	return channels;
}
