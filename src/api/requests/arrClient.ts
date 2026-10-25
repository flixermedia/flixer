import type { RequestServiceKind } from "../../entities/requestService.entity.js";
import { normalizeTitle } from "./externalMetadata.js";

const TIMEOUT_MS = 20_000;

type Json = Record<string, unknown>;

export interface ArrProfile {
	id: number;
	name: string;
}

export interface ArrRootFolder {
	path: string;
	freeSpace: number | null;
}

export interface ArrTestResult {
	ok: boolean;
	version: string | null;
	error: string | null;
	qualityProfiles: ArrProfile[];
	rootFolders: ArrRootFolder[];
	metadataProfiles: ArrProfile[];
	languageProfiles: ArrProfile[];
}

export interface ArrTarget {
	rootFolder: string;
	qualityProfileId: number;
	metadataProfileId: number | null;
	languageProfileId: number | null;
	minimumAvailability: string | null;
	seasonFolders: boolean;
	tags: number[];
}

export class ArrError extends Error {}

/** Trims whitespace and trailing slashes so `http://host:8989/` and `http://host:8989` are the same instance. */
export function normalizeArrUrl(value: string): string | null {

	const trimmed = value.trim().replace(/\/+$/, "");
	if (!URL.canParse(trimmed)) {
		return null;
	}
	const url = new URL(trimmed);
	return url.protocol === "http:" || url.protocol === "https:" ? trimmed : null;

}

function asRecord(value: unknown): Json {
	return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Json) : {};
}

function asList(value: unknown): Json[] {
	return Array.isArray(value) ? value.map(asRecord) : [];
}

function profiles(value: unknown): ArrProfile[] {
	return asList(value)
		.filter((entry) => typeof entry.id === "number" && typeof entry.name === "string")
		.map((entry) => ({ id: entry.id as number, name: entry.name as string }));
}

/** Picks the lookup result whose title matches best: exact (ignoring punctuation) first, otherwise the first result. */
export function pickAlbum(results: Json[], title: string, artist: string | null): Json | null {

	const wanted = normalizeTitle(title);
	const wantedArtist = artist ? normalizeTitle(artist) : null;
	const named = (entry: Json) => normalizeTitle(typeof entry.title === "string" ? entry.title : "") === wanted;
	const sameArtist = (entry: Json) =>
		!wantedArtist ||
		normalizeTitle(
			typeof asRecord(entry.artist).artistName === "string" ? (asRecord(entry.artist).artistName as string) : "",
		) === wantedArtist;
	return results.find((entry) => named(entry) && sameArtist(entry)) ?? results.find(named) ?? results[0] ?? null;

}

/** A thin client for the Sonarr (v3), Radarr (v3) and Lidarr (v1) REST APIs. */
export class ArrClient {

	private readonly base: string;

	constructor(
		private readonly kind: RequestServiceKind,
		url: string,
		private readonly apiKey: string,
	) {
		this.base = `${url.replace(/\/+$/, "")}/api/${kind === "lidarr" ? "v1" : "v3"}`;
	}

	private async call(method: "GET" | "POST" | "PUT", path: string, body?: unknown): Promise<unknown> {
		let response: Response;
		try {
			response = await fetch(`${this.base}${path}`, {
				method,
				headers: {
					"x-api-key": this.apiKey,
					accept: "application/json",
					...(body === undefined ? {} : { "content-type": "application/json" }),
				},
				body: body === undefined ? undefined : JSON.stringify(body),
				signal: AbortSignal.timeout(TIMEOUT_MS),
			});
		} catch (error: unknown) {
			throw new ArrError(
				`Could not reach ${this.kind}: ${error instanceof Error ? error.message : "unknown error"}`,
			);
		}
		if (response.status === 401 || response.status === 403) {
			throw new ArrError(`${this.kind} rejected the API key.`);
		}
		const raw = await response.text();
		let parsed: unknown = null;
		try {
			parsed = raw ? JSON.parse(raw) : null;
		} catch {
			parsed = null;
		}
		if (!response.ok) {
			const detail =
				asList(parsed)
					.map((entry) => entry.errorMessage)
					.filter((message): message is string => typeof message === "string")[0] ??
				(typeof asRecord(parsed).message === "string" ? (asRecord(parsed).message as string) : null);
			throw new ArrError(
				detail ? `${this.kind} answered: ${detail}` : `${this.kind} answered with HTTP ${response.status}.`,
			);
		}
		return parsed;
	}

	async test(): Promise<ArrTestResult> {
		const result: ArrTestResult = {
			ok: false,
			version: null,
			error: null,
			qualityProfiles: [],
			rootFolders: [],
			metadataProfiles: [],
			languageProfiles: [],
		};
		try {
			const status = asRecord(await this.call("GET", "/system/status"));
			result.version = typeof status.version === "string" ? status.version : null;
			result.qualityProfiles = profiles(await this.call("GET", "/qualityprofile"));
			result.rootFolders = asList(await this.call("GET", "/rootfolder"))
				.filter((entry) => typeof entry.path === "string")
				.map((entry) => ({
					path: entry.path as string,
					freeSpace: typeof entry.freeSpace === "number" ? entry.freeSpace : null,
				}));
			if (this.kind === "lidarr") {
				result.metadataProfiles = profiles(await this.call("GET", "/metadataprofile"));
			}
			if (this.kind === "sonarr") {
				// Sonarr v4 dropped language profiles.
				result.languageProfiles = profiles(await this.call("GET", "/languageprofile").catch(() => []));
			}
			result.ok = true;
		} catch (error: unknown) {
			result.error = error instanceof Error ? error.message : "Connection failed.";
		}
		return result;
	}

	/** Adds the movie (or finds it already in Radarr) and starts a search. Returns whether it was newly added. */
	async addMovie(tmdbId: number, target: ArrTarget): Promise<{ created: boolean }> {
		const existing = asList(await this.call("GET", `/movie?tmdbId=${tmdbId}`));
		if (existing.length > 0) {
			const movie = existing[0];
			if (movie.hasFile !== true) {
				await this.call("POST", "/command", { name: "MoviesSearch", movieIds: [movie.id] });
			}
			return { created: false };
		}
		const lookup = asRecord(await this.call("GET", `/movie/lookup/tmdb?tmdbId=${tmdbId}`));
		if (typeof lookup.title !== "string") {
			throw new ArrError("Radarr could not find this movie.");
		}
		await this.call("POST", "/movie", {
			...lookup,
			qualityProfileId: target.qualityProfileId,
			rootFolderPath: target.rootFolder,
			minimumAvailability: target.minimumAvailability ?? "released",
			tags: target.tags,
			monitored: true,
			addOptions: { searchForMovie: true },
		});
		return { created: true };
	}

	/** Adds the series with the requested seasons monitored, or updates the monitoring of an existing series. */
	async addSeries(tvdbId: number, seasons: number[] | null, target: ArrTarget): Promise<{ created: boolean }> {
		const isWanted = (season: number) => seasons === null || seasons.includes(season);
		const existing = asList(await this.call("GET", `/series?tvdbId=${tvdbId}`));
		if (existing.length > 0) {
			const series = existing[0];
			const current = asList(series.seasons);
			const updated = current.map((season) =>
				typeof season.seasonNumber === "number" && season.seasonNumber > 0 && isWanted(season.seasonNumber)
					? { ...season, monitored: true }
					: season,
			);
			await this.call("PUT", `/series/${series.id}`, { ...series, monitored: true, seasons: updated });
			for (const season of updated) {
				if (
					typeof season.seasonNumber === "number" &&
					season.seasonNumber > 0 &&
					season.monitored === true &&
					isWanted(season.seasonNumber)
				) {
					await this.call("POST", "/command", {
						name: "SeasonSearch",
						seriesId: series.id,
						seasonNumber: season.seasonNumber,
					});
				}
			}
			return { created: false };
		}
		const lookup = asList(await this.call("GET", `/series/lookup?term=${encodeURIComponent(`tvdb:${tvdbId}`)}`));
		const found = lookup[0];
		if (!found || typeof found.title !== "string") {
			throw new ArrError("Sonarr could not find this series.");
		}
		await this.call("POST", "/series", {
			...found,
			qualityProfileId: target.qualityProfileId,
			...(target.languageProfileId === null ? {} : { languageProfileId: target.languageProfileId }),
			rootFolderPath: target.rootFolder,
			seasonFolder: target.seasonFolders,
			tags: target.tags,
			monitored: true,
			seasons: asList(found.seasons).map((season) => ({
				...season,
				monitored:
					typeof season.seasonNumber === "number" && season.seasonNumber > 0 && isWanted(season.seasonNumber),
			})),
			addOptions: {
				ignoreEpisodesWithFiles: true,
				ignoreEpisodesWithoutFiles: false,
				searchForMissingEpisodes: true,
			},
		});
		return { created: true };
	}

	/** Looks the album up by "artist title" and adds it (and its artist, unmonitored) to Lidarr. */
	async addAlbum(title: string, artist: string | null, target: ArrTarget): Promise<{ created: boolean }> {
		const term = [artist, title].filter(Boolean).join(" ");
		const results = asList(await this.call("GET", `/album/lookup?term=${encodeURIComponent(term)}`));
		const album = pickAlbum(results, title, artist);
		if (!album || typeof album.foreignAlbumId !== "string") {
			throw new ArrError("Lidarr could not find this album.");
		}
		if (typeof album.id === "number" && album.id > 0) {
			await this.call("PUT", "/album/monitor", { albumIds: [album.id], monitored: true });
			await this.call("POST", "/command", { name: "AlbumSearch", albumIds: [album.id] });
			return { created: false };
		}
		await this.call("POST", "/album", {
			...album,
			monitored: true,
			anyReleaseOk: true,
			artist: {
				...asRecord(album.artist),
				qualityProfileId: target.qualityProfileId,
				metadataProfileId: target.metadataProfileId,
				rootFolderPath: target.rootFolder,
				tags: target.tags,
				monitored: true,
				monitorNewItems: "none",
				addOptions: { monitor: "none", searchForMissingAlbums: false },
			},
			addOptions: { searchForNewAlbum: true },
		});
		return { created: true };
	}
}
