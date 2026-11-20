import { Inject, Injectable } from "@tsed/di";
import { NotFound } from "@tsed/exceptions";
import { randomUUID } from "node:crypto";
import { DataSource } from "typeorm";
import { DefaultDataSource } from "../../datasources/defaultDataSource.datasource.js";
import { Favorite } from "../../entities/favorite.entity.js";
import { ListeningHistory } from "../../entities/listeningHistory.entity.js";
import { MediaItem } from "../../entities/mediaItem.entity.js";
import { Playlist } from "../../entities/playlist.entity.js";
import { SocialFriendship } from "../../entities/social.entity.js";
import { User } from "../../entities/user.entity.js";
import { UserPreference } from "../../entities/userPreference.entity.js";
import { WatchProgress } from "../../entities/watchProgress.entity.js";
import { FavoritesService } from "./favoritesService.js";
import { FriendsService } from "./friendsService.js";
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
	visibility: "public" | "hidden" | "friends";
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
		private readonly friends: FriendsService,
	) {}

	async directory(viewerId: string, query?: string) {
		const term = query?.trim().slice(0, 64);
		const queryBuilder = this.dataSource
			.getRepository(User)
			.createQueryBuilder("u")
			.leftJoin(UserPreference, "up", "up.userId = u.id")
			.select("u.id", "id")
			.addSelect("u.username", "username")
			.addSelect("u.displayName", "display_name")
			.addSelect("u.createdAt", "created_at")
			.addSelect("up.avatarFile", "avatar_file")
			.addSelect((subQuery) => subQuery.select("COUNT(*)::int").from(Favorite, "favorite").where("favorite.userId = u.id"), "favorite_count")
			.addSelect((subQuery) => subQuery.select("COUNT(*)::int").from(Playlist, "playlist").where("playlist.userId = u.id").andWhere("playlist.isPublic = true"), "playlist_count")
			.addSelect((subQuery) => subQuery.select("COALESCE(SUM(history.playCount), 0)::int").from(ListeningHistory, "history").where("history.userId = u.id"), "play_count")
			.where("u.disabledAt IS NULL")
			// RAW SQL: correlated friendship EXISTS preserves friends-only visibility.
			.andWhere("(COALESCE(up.profileVisibility, 'public') = 'public' OR (COALESCE(up.profileVisibility, 'public') = 'friends' AND EXISTS (SELECT 1 FROM social_friendships sf WHERE sf.accepted_at IS NOT NULL AND ((sf.user_low_id = :viewerId AND sf.user_high_id = u.id) OR (sf.user_high_id = :viewerId AND sf.user_low_id = u.id)))))", { viewerId });
		if (term) queryBuilder.andWhere("(u.username ILIKE :term ESCAPE '\\' OR u.displayName ILIKE :term ESCAPE '\\')", { term: likePattern(term) });
		const rows = await queryBuilder.orderBy("LOWER(COALESCE(u.displayName, u.username))", "ASC").take(DIRECTORY_LIMIT).getRawMany<{
			id: string;
			username: string;
			display_name: string | null;
			created_at: Date;
			avatar_file: string | null;
			favorite_count: number;
			playlist_count: number;
			play_count: number;
		}>();
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

	async setVisibility(userId: string, visibility: "public" | "hidden" | "friends") {
		await this.dataSource.getRepository(UserPreference).upsert({ userId, profileVisibility: visibility }, ["userId"]);
		return { visibility };
	}

	/** Profiles outside a user's visibility scope look the same as missing profiles. */
	async profile(viewerId: string, username: string) {
		const user = await this.findUser(username);
		if (!user) {
			throw new NotFound("Profile not found.");
		}
		const isSelf = user.id === viewerId;
		if (!isSelf && user.visibility === "hidden") {
			throw new NotFound("Profile not found.");
		}
		const isFriend = isSelf || (await this.friends.areFriends(viewerId, user.id));
		if (!isSelf && user.visibility === "friends" && !isFriend) {
			throw new NotFound("Profile not found.");
		}
		return this.build(user, viewerId, isSelf, isFriend);
	}

	async ownProfile(viewerId: string) {
		const user = await this.userLookup().where("u.id = :id", { id: viewerId }).getRawOne<UserRow>();
		if (!user) {
			throw new NotFound("Profile not found.");
		}
		return this.build(user, viewerId, true, true);
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
		const current = { itemId, at: Date.now(), position: positionSeconds };
		this.listening.set(userId, current);
		if (!continuing) {
			try {
				// RAW SQL: data-modifying CTEs with ON CONFLICT DO UPDATE across listening_history, listening_events and playback_history
				await this.dataSource.query(
					`WITH recorded AS (
						INSERT INTO listening_history (user_id, item_id, played_at, play_count) VALUES ($1, $2, now(), 1)
						ON CONFLICT (user_id, item_id) DO UPDATE SET played_at = now(), play_count = listening_history.play_count + 1
						RETURNING user_id, item_id
					), event AS (
						INSERT INTO listening_events (user_id, item_id) SELECT user_id, item_id FROM recorded
						RETURNING user_id, item_id
					)
					INSERT INTO playback_history (id, user_id, kind, item_id, watched_seconds)
					SELECT $3, user_id, 'music', item_id, $4 FROM event`,
					[userId, itemId, randomUUID(), Math.max(0, positionSeconds)],
				);
			} catch (error) {
				if (this.listening.get(userId) === current) {
					if (previous) this.listening.set(userId, previous);
					else this.listening.delete(userId);
				}
				throw error;
			}
		}
	}

	private userLookup() {
		return this.dataSource.getRepository(User).createQueryBuilder("u").leftJoin(UserPreference, "up", "up.userId = u.id").select("u.id", "id").addSelect("u.username", "username").addSelect("u.displayName", "display_name").addSelect("u.createdAt", "created_at").addSelect("up.avatarFile", "avatar_file").addSelect("COALESCE(up.profileVisibility, 'public')", "visibility").where("u.disabledAt IS NULL");
	}

	private async findUser(username: string): Promise<UserRow | undefined> {
		return this.userLookup()
			.andWhere("LOWER(u.username) = LOWER(:username)", { username: username.slice(0, 64) })
			.getRawOne<UserRow>();
	}

	private async build(user: UserRow, viewerId: string, isSelf: boolean, isFriend: boolean) {
		const [nowPlaying, recentlyWatched, recentlyListened, favorites, playlists] = await Promise.all([this.nowPlaying(user.id), this.recentlyWatched(user.id), this.recentlyListened(user.id), this.favorites.list(user.id, FAVORITES_LIMIT), this.playlists.listForProfile(user.id, isSelf)]);
		return {
			username: user.username,
			displayName: user.display_name ?? user.username,
			avatarUrl: avatarUrl(user.avatar_file),
			joinedAt: user.created_at,
			isSelf,
			hidden: user.visibility === "hidden",
			visibility: user.visibility,
			friendship: await this.friends.status(viewerId, user.id),
			isFriend,
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

		const progress = await this.dataSource
			.getRepository(WatchProgress)
			.createQueryBuilder("w")
			.select("w.itemId", "item_id")
			.addSelect("w.positionSeconds", "position_seconds")
			.addSelect("w.durationSeconds", "duration_seconds")
			.addSelect("w.updatedAt", "updated_at")
			.where("w.userId = :userId", { userId })
			.andWhere("w.completed = false")
			.andWhere("w.updatedAt > now() - (:milliseconds || ' milliseconds')::interval", { milliseconds: String(PRESENCE_MS) })
			.orderBy("w.updatedAt", "DESC")
			.take(1)
			.getRawOne<{ item_id: string; position_seconds: number; duration_seconds: number; updated_at: Date }>();

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
			? {
					kind: "watching",
					item: toSocialItem(card),
					positionSeconds: progress.position_seconds,
					durationSeconds: progress.duration_seconds > 0 ? progress.duration_seconds : null,
				}
			: {
					kind: "listening",
					item: toSocialItem(card),
					positionSeconds: fresh?.position ?? 0,
					durationSeconds: null,
				};
	}

	private async recentlyWatched(userId: string): Promise<SocialItem[]> {
		const rows = await this.dataSource.getRepository(WatchProgress).createQueryBuilder("w").innerJoin(MediaItem, "m", "m.id = w.itemId").select("w.itemId", "item_id").addSelect("w.updatedAt", "updated_at").where("w.userId = :userId", { userId }).andWhere("m.type IN ('movie', 'episode', 'video')").orderBy("w.updatedAt", "DESC").take(RECENT_LIMIT).getRawMany<{ item_id: string; updated_at: Date }>();
		const cards = await loadSocialItems(
			this.dataSource,
			rows.map((row) => row.item_id),
			new Map(rows.map((row) => [row.item_id, row.updated_at])),
		);
		return cards.map(toSocialItem);
	}

	private async recentlyListened(userId: string): Promise<SocialItem[]> {
		const rows = await this.dataSource.getRepository(ListeningHistory).find({ select: { itemId: true, playedAt: true }, where: { userId }, order: { playedAt: "DESC" }, take: RECENT_LIMIT });
		const cards = await loadSocialItems(
			this.dataSource,
			rows.map((row) => row.itemId),
			new Map(rows.map((row) => [row.itemId, row.playedAt])),
		);
		return cards.map(toSocialItem);
	}
}
