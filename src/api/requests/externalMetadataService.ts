import { Inject, Injectable } from "@tsed/di";
import { BadRequest, NotFound } from "@tsed/exceptions";
import { DataSource } from "typeorm";
import { DefaultDataSource } from "../../datasources/defaultDataSource.datasource.js";
import type { RequestMediaType } from "../../entities/mediaRequest.entity.js";
import { Setting } from "../../entities/setting.entity.js";
import { INDEXER_LANGUAGE_KEY, INDEXER_PROVIDERS_KEY } from "../indexer/indexerSettingsService.js";
import {
	type DiscoverSection,
	type ExternalMediaCard,
	type ExternalMediaDetail,
	splitDiscogsTitle,
	yearOf,
} from "./externalMetadata.js";

const TMDB_API = "https://api.themoviedb.org/3";
const TMDB_IMAGES = "https://image.tmdb.org/t/p";
const DISCOGS_API = "https://api.discogs.com";
const TIMEOUT_MS = 10_000;
const USER_AGENT = "Flixer/1.0 (+https://flixer.dev)";

type Json = Record<string, unknown>;

function asRecord(value: unknown): Json {
	return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Json) : {};
}

function asList(value: unknown): Json[] {
	return Array.isArray(value) ? value.map(asRecord) : [];
}

function text(value: unknown): string | null {
	return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function image(path: unknown, size: string): string | null {
	return typeof path === "string" && path.startsWith("/") ? `${TMDB_IMAGES}/${size}${path}` : null;
}

/** Looks titles up on TMDB (movies and shows) and Discogs (albums) for things that are not in the library yet. */
@Injectable()
export class ExternalMetadataService {

	constructor(@Inject(DefaultDataSource) private readonly dataSource: DataSource) {}

	private async providerConfig(): Promise<{ tmdbKey: string; discogsToken: string; language: string }> {
		const rows = await this.dataSource.getRepository(Setting).find();
		const value = (key: string) => rows.find((row) => row.key === key)?.value;
		const providers = asRecord(value(INDEXER_PROVIDERS_KEY));
		const key = (name: string) => {
			const provider = asRecord(providers[name]);
			return provider.enabled !== false && typeof provider.apiKey === "string" ? provider.apiKey.trim() : "";
		};
		const language = value(INDEXER_LANGUAGE_KEY);
		return {
			tmdbKey: key("tmdb"),
			discogsToken: key("discogs"),
			language: typeof language === "string" ? language : "en",
		};
	}

	async isConfigured(): Promise<{ tmdb: boolean; discogs: boolean }> {
		const { tmdbKey, discogsToken } = await this.providerConfig();
		return { tmdb: tmdbKey !== "", discogs: discogsToken !== "" };
	}

	private async get(url: URL, headers: Record<string, string> = {}): Promise<Json> {
		let response: Response;
		try {
			response = await fetch(url, {
				headers: { accept: "application/json", "user-agent": USER_AGENT, ...headers },
				signal: AbortSignal.timeout(TIMEOUT_MS),
			});
		} catch {
			throw new BadRequest("The metadata provider could not be reached.");
		}
		if (response.status === 404) {
			throw new NotFound("Not found at the metadata provider.");
		}
		if (!response.ok) {
			throw new BadRequest(
				`The metadata provider answered with HTTP ${response.status}. Check its API key under Providers.`,
			);
		}
		return asRecord(await response.json());
	}

	private async tmdb(path: string, params: Record<string, string> = {}): Promise<Json> {
		const { tmdbKey, language } = await this.providerConfig();
		if (!tmdbKey) {
			throw new BadRequest("TMDB is not configured. Add a TMDB API key under Providers.");
		}
		const url = new URL(`${TMDB_API}${path}`);
		url.searchParams.set("api_key", tmdbKey);
		url.searchParams.set("language", language);
		for (const [name, value] of Object.entries(params)) {
			url.searchParams.set(name, value);
		}
		return this.get(url);
	}

	private async discogs(path: string, params: Record<string, string> = {}): Promise<Json> {
		const { discogsToken } = await this.providerConfig();
		if (!discogsToken) {
			throw new BadRequest("Discogs is not configured. Add a Discogs token under Providers.");
		}
		const url = new URL(`${DISCOGS_API}${path}`);
		for (const [name, value] of Object.entries(params)) {
			url.searchParams.set(name, value);
		}
		return this.get(url, { authorization: `Discogs token=${discogsToken}` });
	}

	private tmdbCard(entry: Json, type: "movie" | "tv"): ExternalMediaCard | null {
		const id = entry.id;
		const title = text(type === "movie" ? entry.title : entry.name);
		if (typeof id !== "number" || !title) {
			return null;
		}
		return {
			source: "tmdb",
			type,
			id: String(id),
			title,
			year: yearOf(type === "movie" ? entry.release_date : entry.first_air_date),
			poster: image(entry.poster_path, "w342"),
			overview: text(entry.overview),
			status: "none",
			requestId: null,
		};
	}

	private discogsCard(entry: Json): ExternalMediaCard | null {
		const id = entry.master_id && entry.master_id !== 0 ? entry.master_id : entry.id;
		const label = text(entry.title);
		if ((typeof id !== "number" && typeof id !== "string") || !label) {
			return null;
		}
		const { artist, title } = splitDiscogsTitle(label);
		const cover = text(entry.cover_image) ?? text(entry.thumb);
		return {
			source: "discogs",
			type: "music",
			id: String(id),
			title,
			year: yearOf(entry.year),
			poster: cover && !cover.includes("spacer.gif") ? cover : null,
			overview: artist,
			status: "none",
			requestId: null,
		};
	}

	async search(
		query: string,
		type?: RequestMediaType,
		enabled: Record<RequestMediaType, boolean> = { movie: true, tv: true, music: true },
	): Promise<ExternalMediaCard[]> {
		const config = await this.isConfigured();
		const wanted = (kind: RequestMediaType) => (!type || type === kind) && enabled[kind];
		const jobs: Array<Promise<ExternalMediaCard[]>> = [];

		if (config.tmdb && (wanted("movie") || wanted("tv"))) {
			jobs.push(
				this.tmdb("/search/multi", { query, include_adult: "false" }).then((body) =>
					asList(body.results)
						.filter(
							(entry) =>
								(entry.media_type === "movie" && wanted("movie")) ||
								(entry.media_type === "tv" && wanted("tv")),
						)
						.map((entry) => this.tmdbCard(entry, entry.media_type as "movie" | "tv"))
						.filter((card): card is ExternalMediaCard => card !== null)
						.slice(0, 24),
				),
			);
		}
		if (config.discogs && wanted("music")) {
			jobs.push(
				this.discogs("/database/search", { q: query, type: "master", per_page: "24" }).then((body) =>
					asList(body.results)
						.map((entry) => this.discogsCard(entry))
						.filter((card): card is ExternalMediaCard => card !== null),
				),
			);
		}

		const settled = await Promise.allSettled(jobs);
		if (settled.length > 0 && settled.every((result) => result.status === "rejected")) {
			throw (settled[0] as PromiseRejectedResult).reason;
		}
		return settled.flatMap((result) => (result.status === "fulfilled" ? result.value : []));
	}

	async discover(section: DiscoverSection): Promise<ExternalMediaCard[]> {
		const mapMovies = (body: Json) => asList(body.results).map((entry) => this.tmdbCard(entry, "movie"));
		const mapTv = (body: Json) => asList(body.results).map((entry) => this.tmdbCard(entry, "tv"));
		let cards: Array<ExternalMediaCard | null>;
		switch (section) {
			case "trending":
				cards = asList((await this.tmdb("/trending/all/week")).results)
					.filter((entry) => entry.media_type === "movie" || entry.media_type === "tv")
					.map((entry) => this.tmdbCard(entry, entry.media_type as "movie" | "tv"));
				break;
			case "movies":
				cards = mapMovies(await this.tmdb("/movie/popular"));
				break;
			case "tv":
				cards = mapTv(await this.tmdb("/tv/popular"));
				break;
			case "upcoming":
				cards = mapMovies(await this.tmdb("/movie/upcoming"));
				break;
			case "music": {
				const year = new Date().getFullYear();
				const body = await this.discogs("/database/search", {
					type: "master",
					sort: "have",
					sort_order: "desc",
					year: String(year - 1),
					per_page: "24",
				});
				cards = asList(body.results).map((entry) => this.discogsCard(entry));
				break;
			}
		}
		return cards.filter((card): card is ExternalMediaCard => card !== null);
	}

	async details(type: RequestMediaType, id: string): Promise<ExternalMediaDetail> {
		if (!/^\d{1,12}$/.test(id)) {
			throw new BadRequest("Invalid id.");
		}
		return type === "music" ? this.albumDetails(id) : this.screenDetails(type, id);
	}

	private async screenDetails(type: "movie" | "tv", id: string): Promise<ExternalMediaDetail> {
		const body = await this.tmdb(`/${type}/${id}`, { append_to_response: "credits" });
		const card = this.tmdbCard(body, type);
		if (!card) {
			throw new NotFound("Not found at TMDB.");
		}
		const runtimes = Array.isArray(body.episode_run_time) ? body.episode_run_time : [];
		const runtime =
			typeof body.runtime === "number" ? body.runtime : typeof runtimes[0] === "number" ? runtimes[0] : null;
		const cast = asList(asRecord(body.credits).cast)
			.map((person) => text(person.name))
			.filter((name): name is string => name !== null)
			.slice(0, 12);
		return {
			...card,
			backdrop: image(body.backdrop_path, "w1280"),
			tagline: text(body.tagline),
			genres: asList(body.genres)
				.map((genre) => text(genre.name))
				.filter((name): name is string => name !== null),
			runtimeMinutes: runtime && runtime > 0 ? runtime : null,
			rating:
				typeof body.vote_average === "number" && body.vote_average > 0
					? Math.round(body.vote_average * 10) / 10
					: null,
			cast,
			artist: null,
			seasons:
				type === "tv"
					? asList(body.seasons)
							.filter((season) => typeof season.season_number === "number" && season.season_number > 0)
							.map((season) => ({
								number: season.season_number as number,
								name: text(season.name) ?? `Season ${season.season_number}`,
								episodeCount: typeof season.episode_count === "number" ? season.episode_count : 0,
								status: "none" as const,
							}))
					: null,
			tracklist: null,
		};
	}

	private async albumDetails(id: string): Promise<ExternalMediaDetail> {
		const body = await this.discogs(`/masters/${id}`);
		const label = text(body.title);
		if (!label) {
			throw new NotFound("Not found at Discogs.");
		}
		const artists = asList(body.artists)
			.map((artist) => text(artist.name)?.replace(/\s*\(\d+\)$/, "") ?? null)
			.filter((name): name is string => name !== null);
		const images = asList(body.images);
		const cover = text(images[0]?.uri) ?? text(images[0]?.resource_url);
		return {
			source: "discogs",
			type: "music",
			id,
			title: label,
			year: yearOf(body.year),
			poster: cover,
			overview: text(body.notes),
			status: "none",
			requestId: null,
			backdrop: null,
			tagline: null,
			genres: [
				...(Array.isArray(body.genres) ? body.genres : []),
				...(Array.isArray(body.styles) ? body.styles : []),
			].filter((entry): entry is string => typeof entry === "string"),
			runtimeMinutes: null,
			rating: null,
			cast: [],
			artist: artists.join(", ") || null,
			seasons: null,
			tracklist: asList(body.tracklist)
				.map((track) => text(track.title))
				.filter((title): title is string => title !== null),
		};
	}

	/** The TVDB id Sonarr needs for a TMDB show. */
	async tvdbIdOfShow(tmdbId: string): Promise<number | null> {
		const body = await this.tmdb(`/tv/${tmdbId}/external_ids`);
		return typeof body.tvdb_id === "number" ? body.tvdb_id : null;
	}
}
