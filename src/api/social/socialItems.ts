import { In, type DataSource } from "typeorm";
import { MediaItem, type MediaItemType } from "../../entities/mediaItem.entity.js";

/** A library item shown as a card on a profile, favourites list or playlist. */
export interface SocialItem {
	id: string;
	type: MediaItemType;
	title: string;
	subtitle: string | null;
	year: number | null;
	/** The item whose artwork to show; tracks use their album and episodes their series. */
	imageItemId: string;
	imageIndex: number | null;
	imageUpdatedAt: Date;
	updatedAt: Date;
	at?: Date;
}

export type LoadedSocialItem = SocialItem & { raw: MediaItem; album: MediaItem | null };

export const FAVORITE_TYPES: MediaItemType[] = ["movie", "series", "album", "track", "video"];

interface StoredImage {
	type?: unknown;
	path?: unknown;
}

export function imageIndexOf(images: unknown[] | null | undefined, types: string[]): number | null {
	const list = (images ?? []) as StoredImage[];
	for (const type of types) {
		const index = list.findIndex((image) => image?.type === type && typeof image.path === "string" && image.path.length > 0);
		if (index >= 0) {
			return index;
		}
	}
	return null;
}

function text(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function artistOf(item: MediaItem): string | null {
	return text(item.metadata?.artist) ?? text(item.metadata?.albumArtist);
}

export function durationOf(item: MediaItem): number | null {
	const seconds = Number(item.technical?.duration);
	return Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds) : null;
}

/** Loads the items (skipping placeholders and missing ones) and returns cards in the order of `ids`. */
export async function loadSocialItems(dataSource: DataSource, ids: string[], at?: Map<string, Date>): Promise<LoadedSocialItem[]> {
	if (ids.length === 0) {
		return [];
	}
	const repo = dataSource.getRepository(MediaItem);
	const items = await repo.find({ where: { id: In(ids), isPlaceholder: false } });
	const byId = new Map(items.map((item) => [item.id, item]));

	const parentIds = [...new Set(items.filter((item) => (item.type === "track" || item.type === "episode") && item.parentId).map((item) => item.parentId as string))];
	const parents = parentIds.length > 0 ? await repo.findBy({ id: In(parentIds) }) : [];
	const parentById = new Map(parents.map((parent) => [parent.id, parent]));
	const seriesIds = [...new Set(parents.filter((parent) => parent.type === "season" && parent.parentId).map((parent) => parent.parentId as string))];
	const seriesList = seriesIds.length > 0 ? await repo.findBy({ id: In(seriesIds) }) : [];
	const seriesById = new Map(seriesList.map((series) => [series.id, series]));

	const cards: LoadedSocialItem[] = [];
	for (const id of ids) {
		const item = byId.get(id);
		if (!item) {
			continue;
		}
		const parent = item.parentId ? parentById.get(item.parentId) : undefined;
		const album = item.type === "track" && parent?.type === "album" ? parent : null;
		const series = item.type === "episode" && parent?.parentId ? seriesById.get(parent.parentId) : undefined;

		let title = item.title;
		let subtitle: string | null = item.year ? String(item.year) : null;
		let imageSource: MediaItem = item;
		let index = imageIndexOf(item.images, ["poster", "thumb", "backdrop"]);

		if (item.type === "track") {
			subtitle = [artistOf(item) ?? (album ? artistOf(album) : null), album?.title].filter(Boolean).join(" · ") || null;
			if (album) {
				imageSource = album;
				index = imageIndexOf(album.images, ["poster", "thumb", "backdrop"]);
			}
		} else if (item.type === "album") {
			subtitle = [artistOf(item), item.year].filter(Boolean).join(" · ") || null;
		} else if (item.type === "episode" && series) {
			const code = parent?.seasonNumber != null && item.episodeNumber != null ? `S${parent.seasonNumber}E${item.episodeNumber}` : null;
			title = series.title;
			subtitle = [code, item.title].filter(Boolean).join(" · ") || null;
			imageSource = series;
			index = imageIndexOf(series.images, ["poster", "thumb", "backdrop"]);
		}

		cards.push({
			id: item.id,
			type: item.type,
			title,
			subtitle,
			year: item.year,
			imageItemId: imageSource.id,
			imageIndex: index,
			imageUpdatedAt: imageSource.updatedAt,
			updatedAt: item.updatedAt,
			...(at?.has(id) ? { at: at.get(id) } : {}),
			raw: item,
			album,
		});
	}
	return cards;
}

/** Drops the internal fields so only the card is returned to clients. */
export function toSocialItem({ raw: _raw, album: _album, ...card }: LoadedSocialItem): SocialItem {
	return card;
}
