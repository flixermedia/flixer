export interface EpisodeRef {
	id: string;
	title: string;
	seasonNumber: number | null;
	episodeNumber: number | null;
}

export interface NextEpisode {
	id: string;
	title: string;
	seasonNumber: number | null;
	episodeNumber: number | null;
}

const order = (value: number | null) => value ?? Number.MAX_SAFE_INTEGER;

/**
 * The episode that plays after `currentId`: the next one in its season, else the first of the next season.
 * Specials (season 0) are only entered when the current episode is itself a special. Returns null for the last episode.
 */
export function pickNextEpisode(currentId: string, episodes: EpisodeRef[]): NextEpisode | null {
	const current = episodes.find((episode) => episode.id === currentId);
	if (!current) {
		return null;
	}
	const inSpecials = current.seasonNumber === 0;
	const sorted = episodes
		.filter((episode) => inSpecials || episode.seasonNumber !== 0)
		.sort((a, b) => order(a.seasonNumber) - order(b.seasonNumber) || order(a.episodeNumber) - order(b.episodeNumber) || a.title.localeCompare(b.title));
	const index = sorted.findIndex((episode) => episode.id === currentId);
	const next = index >= 0 ? sorted[index + 1] : undefined;
	if (!next || (inSpecials && next.seasonNumber !== 0)) {
		return null;
	}
	return { id: next.id, title: next.title, seasonNumber: next.seasonNumber, episodeNumber: next.episodeNumber };
}
