import type { RequestMediaType, RequestSource, RequestStatus } from "../../entities/mediaRequest.entity.js";

export interface ExternalMediaCard {
	source: RequestSource;
	type: RequestMediaType;
	id: string;
	title: string;
	year: number | null;
	poster: string | null;
	overview: string | null;
	status: RequestStatus | "none";
	requestId: string | null;
}

export interface ExternalSeason {
	number: number;
	name: string;
	episodeCount: number;
	status: RequestStatus | "none";
}

export interface ExternalMediaDetail extends ExternalMediaCard {
	backdrop: string | null;
	tagline: string | null;
	genres: string[];
	runtimeMinutes: number | null;
	rating: number | null;
	cast: string[];
	artist: string | null;
	seasons: ExternalSeason[] | null;
	tracklist: string[] | null;
}

export type DiscoverSection = "trending" | "movies" | "tv" | "upcoming" | "music";
export const DISCOVER_SECTIONS: DiscoverSection[] = ["trending", "movies", "tv", "upcoming", "music"];

/** The year at the start of a date such as 2010-07-16, or null. */
export function yearOf(value: unknown): number | null {

	if (typeof value === "number" && Number.isInteger(value) && value > 0) {
		return value;
	}
	if (typeof value !== "string") {
		return null;
	}
	const year = Number.parseInt(value.slice(0, 4), 10);
	return Number.isInteger(year) && year > 0 ? year : null;

}

/** Discogs titles look like "Artist - Album"; some artists carry a "(2)" disambiguation suffix. */
export function splitDiscogsTitle(value: string): { artist: string | null; title: string } {

	const index = value.indexOf(" - ");
	if (index < 0) {
		return { artist: null, title: value.trim() };
	}
	const artist = value
		.slice(0, index)
		.replace(/\s*\(\d+\)$/, "")
		.trim();
	return { artist: artist || null, title: value.slice(index + 3).trim() };

}

/** Lowercase letters and digits only, so titles compare equal across punctuation and spacing. */
export function normalizeTitle(value: string): string {
	return value
		.normalize("NFKD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "");
}
