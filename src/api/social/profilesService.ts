import { Inject, Injectable } from "@tsed/di";
import { NotFound } from "@tsed/exceptions";
import { DataSource } from "typeorm";
import { DefaultDataSource } from "../../datasources/defaultDataSource.datasource.js";
import { MediaItem } from "../../entities/mediaItem.entity.js";
import { UserPreference } from "../../entities/userPreference.entity.js";
import { FavoritesService } from "./favoritesService.js";
import { PlaylistsService } from "./playlistsService.js";
import { loadSocialItems, toSocialItem, type SocialItem } from "./socialItems.js";

/** How long after the last report or saved position someone still counts as watching or listening. */
export const PRESENCE_MS = 3 * 60 * 1000;
const RECENT_LIMIT = 20;
const FAVORITES_LIMIT = 100;
const DIRECTORY_LIMIT = 200;

interface UserRow {
	id: string;
	username: string;
	display_name: string | null;
	created_at: Date;
	avatar_file: string | null;
	hidden: boolean;
}

export interface NowPlaying {
	kind: "watching" | "listening";
	item: SocialItem;
	positionSeconds: number;
	durationSeconds: number | null;
}

const avatarUrl = (file: string | null) => (file ? `/auth/avatars/${file}` : null);

/** Whether a listening report is still fresh enough to show. */
export function isFresh(at: number, now = Date.now()): boolean {
	return now - at <= PRESENCE_MS;
}

/** Escapes LIKE wildcards so a search term matches literally. */
export function likePattern(term: string): string {
	return `%${term.replace(/[\\%_]/g, "\\$&")}%`;
}

@Injectable()
export class ProfilesService {

	/** What each user is playing right now. Short-lived by design, so it is kept in memory. */
	private readonly listening = new Map<string, { itemId: string; at: number; position: number }>();

	constructor(
		@Inject(DefaultDataSource) private readonly dataSource: DataSource,
		private readonly favorites: FavoritesService,
		private readonly playlists: PlaylistsService,
	) {}

	async directory(query?: string) {
		const term = query?.trim().slice(0, 64);
		const rows = (await this.dataSource.query(
			`SELECT u.id, u.username, u.display_name, u.created_at, up.avatar_file,
				(SELECT count(*) FROM favorites f WHERE f.user_id = u.id)::int AS favorite_count,
				(SELECT count(*) FROM playlists p WHERE p.user_id = u.id AND p.is_public = true)::int AS playlist_count,
				(SELECT count(*) FROM listening_history h WHERE h.user_id = u.id)::int AS play_count
			FROM users u LEFT JOIN user_preferences up ON up.user_id = u.id
			WHERE u.disabled_at IS NULL AND COALESCE(up.profile_hidden, false) = false
			${term ? `AND (u.username ILIKE $1 ESCAPE '\\' OR u.display_name ILIKE $1 ESCAPE '\\')` : ""}
			ORDER BY lower(COALESCE(u.display_name, u.username)) LIMIT ${DIRECTORY_LIMIT}`,
			term ? [likePattern(term)] : [],
		)) as Array<{
			id: string;
			username: string;
			display_name: string | null;
			created_at: Date;
			avatar_file: string | null;
			favorite_count: number;
			playlist_count: number;
			play_count: number;
		}>;
		const profiles = await Promise.all(
			rows.map(async (row) => ({
				username: row.username,
				displayName: row.display_name ?? row.username,
				avatarUrl: avatarUrl(row.avatar_file),
				joinedAt: row.created_at,
				favoriteCount: row.favorite_count,
				playlistCount: row.playlist_count,
				playCount: row.play_count,
				nowPlaying: await this.nowPlaying(row.id),
			})),
		);
		return { profiles };
	}

	async setHidden(userId: string, hidden: boolean): Promise<{ hidden: boolean }> {
		await this.dataSource.getRepository(UserPreference).upsert({ userId, profileHidden: hidden }, ["userId"]);
		return { hidden };
	}

	/** A hidden profile looks the same as a missing one to everybody but its owner. */
	async profile(viewerId: string, username: string) {
		const user = await this.findUser(username);
		if (!user || (user.hidden && user.id !== viewerId)) {
			throw new NotFound("Profile not found.");
		}
		return this.build(user, user.id === viewerId);
	}

	async ownProfile(viewerId: string) {
		const rows = (await this.dataSource.query(this.userSql(`u.id = $1`), [viewerId])) as UserRow[];
		if (!rows[0]) {
			throw new NotFound("Profile not found.");
		}
		return this.build(rows[0], true);
	}

	/** Records that the user started, continued or stopped playing a song. */
	async reportListening(userId: string, itemId: string, state: "playing" | "stopped", positionSeconds = 0): Promise<void> {
		if (state === "stopped") {
			if (this.listening.get(userId)?.itemId === itemId) {
				this.listening.delete(userId);
			}
			return;
		}
		const item = await this.dataSource.getRepository(MediaItem).findOne({ where: { id: itemId, isPlaceholder: false }, select: { id: true, type: true } });
		if (!item || item.type !== "track") {
			throw new NotFound("Song not found.");
		}
		const previous = this.listening.get(userId);
		const continuing = previous?.itemId === itemId && isFresh(previous.at);
		this.listening.set(userId, { itemId, at: Date.now(), position: positionSeconds });
		if (!continuing) {
			await this.dataSource.query(
				`INSERT INTO listening_history (user_id, item_id, played_at, play_count) VALUES ($1, $2, now(), 1)
				ON CONFLICT (user_id, item_id) DO UPDATE SET played_at = now(), play_count = listening_history.play_count + 1`,
				[userId, itemId],
			);
		}
	}

	private userSql(where: string): string {
		return `SELECT u.id, u.username, u.display_name, u.created_at, up.avatar_file, COALESCE(up.profile_hidden, false) AS hidden
			FROM users u LEFT JOIN user_preferences up ON up.user_id = u.id WHERE ${where} AND u.disabled_at IS NULL`;
	}

	private async findUser(username: string): Promise<UserRow | undefined> {
		const rows = (await this.dataSource.query(this.userSql(`lower(u.username) = lower($1)`), [username.slice(0, 64)])) as UserRow[];
		return rows[0];
	}

	private async build(user: UserRow, isSelf: boolean) {
		const [nowPlaying, recentlyWatched, recentlyListened, favorites, playlists] = await Promise.all([
			this.nowPlaying(user.id),
			this.recentlyWatched(user.id),
			this.recentlyListened(user.id),
			this.favorites.list(user.id, FAVORITES_LIMIT),
			this.playlists.listForProfile(user.id, isSelf),
		]);
		return {
			username: user.username,
			displayName: user.display_name ?? user.username,
			avatarUrl: avatarUrl(user.avatar_file),
			joinedAt: user.created_at,
			isSelf,
			hidden: user.hidden,
			nowPlaying,
			recentlyWatched,
			recentlyListened,
			favorites,
			playlists,
		};
	}

	private async nowPlaying(userId: string): Promise<NowPlaying | null> {
		const song = this.listening.get(userId);
		if (song && !isFresh(song.at)) {
			this.listening.delete(userId);
		}
		const fresh = song && isFresh(song.at) ? song : undefined;

		const [progress] = (await this.dataSource.query(
			`SELECT item_id, position_seconds, duration_seconds, updated_at FROM watch_progress
			WHERE user_id = $1 AND completed = false AND updated_at > now() - ($2 || ' milliseconds')::interval ORDER BY updated_at DESC LIMIT 1`,
			[userId, String(PRESENCE_MS)],
		)) as Array<{ item_id: string; position_seconds: number; duration_seconds: number; updated_at: Date }>;

		const watching = progress && (!fresh || progress.updated_at.getTime() > fresh.at);
		const itemId = watching ? progress.item_id : fresh?.itemId;
		if (!itemId) {
			return null;
		}
		const [card] = await loadSocialItems(this.dataSource, [itemId]);
		if (!card) {
			return null;
		}
		return watching
			? { kind: "watching", item: toSocialItem(card), positionSeconds: progress.position_seconds, durationSeconds: progress.duration_seconds > 0 ? progress.duration_seconds : null }
			: { kind: "listening", item: toSocialItem(card), positionSeconds: fresh?.position ?? 0, durationSeconds: null };
	}

	private async recentlyWatched(userId: string): Promise<SocialItem[]> {
		const rows = (await this.dataSource.query(
			`SELECT w.item_id, w.updated_at FROM watch_progress w JOIN media_items m ON m.id = w.item_id
			WHERE w.user_id = $1 AND m.type IN ('movie', 'episode', 'video') ORDER BY w.updated_at DESC LIMIT $2`,
			[userId, RECENT_LIMIT],
		)) as Array<{ item_id: string; updated_at: Date }>;
		const cards = await loadSocialItems(this.dataSource, rows.map((row) => row.item_id), new Map(rows.map((row) => [row.item_id, row.updated_at])));
		return cards.map(toSocialItem);
	}

	private async recentlyListened(userId: string): Promise<SocialItem[]> {
		const rows = (await this.dataSource.query(`SELECT item_id, played_at FROM listening_history WHERE user_id = $1 ORDER BY played_at DESC LIMIT $2`, [userId, RECENT_LIMIT])) as Array<{
			item_id: string;
			played_at: Date;
		}>;
		const cards = await loadSocialItems(this.dataSource, rows.map((row) => row.item_id), new Map(rows.map((row) => [row.item_id, row.played_at])));
		return cards.map(toSocialItem);
	}
}
