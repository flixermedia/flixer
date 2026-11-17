import { Inject, Injectable } from "@tsed/di";
import { BadRequest, NotFound } from "@tsed/exceptions";
import { randomUUID } from "node:crypto";
import { DataSource } from "typeorm";
import { DefaultDataSource } from "../../datasources/defaultDataSource.datasource.js";
import { MediaItem } from "../../entities/mediaItem.entity.js";
import { Playlist } from "../../entities/playlist.entity.js";
import { PlaylistItem } from "../../entities/playlistItem.entity.js";
import { artistOf, durationOf, loadSocialItems, toSocialItem, type SocialItem } from "./socialItems.js";

const MAX_PLAYLISTS = 200;
const MAX_TRACKS = 5000;

export interface PlaylistSummary {
	id: string;
	name: string;
	description: string | null;
	isPublic: boolean;
	trackCount: number;
	durationSeconds: number;
	cover: { itemId: string; index: number; updatedAt: Date } | null;
	owner: { username: string; displayName: string; avatarUrl: string | null };
	updatedAt: Date;
}

export type PlaylistTrack = SocialItem & {
	artist: string | null;
	album: string | null;
	albumId: string | null;
	durationSeconds: number | null;
	position: number;
};

interface OwnerRow {
	id: string;
	username: string;
	display_name: string | null;
	avatar_file: string | null;
}

/** Playlists are made of songs only; public playlists follow their owner's profile visibility. */
@Injectable()
export class PlaylistsService {
	constructor(@Inject(DefaultDataSource) private readonly dataSource: DataSource) {}

	async listOwn(userId: string): Promise<PlaylistSummary[]> {
		const rows = await this.dataSource
			.getRepository(Playlist)
			.find({ where: { userId }, order: { updatedAt: "DESC" } });
		return this.summaries(rows);
	}

	/** Playlists others may see on a profile: the public ones, or all of them for the owner. */
	async listForProfile(ownerId: string, includePrivate: boolean): Promise<PlaylistSummary[]> {
		const rows = await this.dataSource.getRepository(Playlist).find({
			where: includePrivate ? { userId: ownerId } : { userId: ownerId, isPublic: true },
			order: { updatedAt: "DESC" },
		});
		return this.summaries(rows);
	}

	async create(
		userId: string,
		input: { name: string; description?: string | null; isPublic?: boolean },
	): Promise<PlaylistSummary> {
		const name = input.name?.trim();
		if (!name || name.length > 100) {
			throw new BadRequest("Playlist name must be 1 to 100 characters.");
		}
		const description = this.cleanDescription(input.description);
		const repo = this.dataSource.getRepository(Playlist);
		if ((await repo.countBy({ userId })) >= MAX_PLAYLISTS) {
			throw new BadRequest(`You can have up to ${MAX_PLAYLISTS} playlists.`);
		}
		const playlist = await repo.save(
			repo.create({ id: randomUUID(), userId, name, description, isPublic: input.isPublic ?? true }),
		);
		return (await this.summaries([playlist]))[0];
	}

	async update(
		userId: string,
		id: string,
		changes: { name?: string; description?: string | null; isPublic?: boolean },
	): Promise<PlaylistSummary> {
		const repo = this.dataSource.getRepository(Playlist);
		const playlist = await repo.findOneBy({ id, userId });
		if (!playlist) {
			throw new NotFound("Playlist not found.");
		}
		if (changes.name !== undefined) {
			const name = changes.name.trim();
			if (!name || name.length > 100) {
				throw new BadRequest("Playlist name must be 1 to 100 characters.");
			}
			playlist.name = name;
		}
		if (changes.description !== undefined) {
			playlist.description = this.cleanDescription(changes.description);
		}
		if (typeof changes.isPublic === "boolean") {
			playlist.isPublic = changes.isPublic;
		}
		await repo.save(playlist);
		return (await this.summaries([playlist]))[0];
	}

	async remove(userId: string, id: string): Promise<void> {
		await this.dataSource.getRepository(Playlist).delete({ id, userId });
	}

	/** One playlist with its songs, for its owner or, when public, anyone whose owner has not hidden their profile. */
	async get(viewerId: string, id: string) {
		const playlist = await this.dataSource.getRepository(Playlist).findOneBy({ id });
		if (!playlist) {
			throw new NotFound("Playlist not found.");
		}
		const isOwner = playlist.userId === viewerId;
		if (!isOwner && (!playlist.isPublic || !(await this.ownerVisible(viewerId, playlist.userId)))) {
			throw new NotFound("Playlist not found.");
		}

		const entries = await this.dataSource
			.getRepository(PlaylistItem)
			.find({ where: { playlistId: id }, order: { position: "ASC", addedAt: "ASC" } });
		const loaded = await loadSocialItems(
			this.dataSource,
			entries.map((entry) => entry.itemId),
		);
		const positions = new Map(entries.map((entry, index) => [entry.itemId, index]));
		const tracks: PlaylistTrack[] = loaded.map((card) => ({
			...toSocialItem(card),
			artist: artistOf(card.raw) ?? (card.album ? artistOf(card.album) : null),
			album: card.album?.title ?? null,
			albumId: card.album?.id ?? null,
			durationSeconds: durationOf(card.raw),
			position: positions.get(card.id) ?? 0,
		}));

		const summary = (await this.summaries([playlist]))[0];
		return { ...summary, isOwner, tracks };
	}

	/** Adds a song, or every song of an album in disc and track order. Songs already in the playlist are skipped. */
	async addTrack(userId: string, id: string, itemId: string): Promise<{ added: number }> {
		await this.requireOwned(userId, id);
		const item = await this.dataSource
			.getRepository(MediaItem)
			.findOne({ where: { id: itemId, isPlaceholder: false }, select: { id: true, type: true } });
		if (!item) {
			throw new NotFound("Media item not found.");
		}
		if (item.type !== "track" && item.type !== "album") {
			throw new BadRequest("Only songs and albums can be added to a playlist.");
		}
		return this.dataSource.transaction(async (manager) => {
			// Serialises concurrent adds so positions stay unique and the size cap holds.
			await manager.query(`SELECT 1 FROM playlists WHERE id = $1 FOR UPDATE`, [id]);
			const trackIds =
				item.type === "track"
					? [itemId]
					: (
							(await manager.query(
								`SELECT id FROM media_items WHERE parent_id = $1 AND type = 'track' AND is_placeholder = false ORDER BY season_number NULLS FIRST, episode_number NULLS LAST, sort_title NULLS LAST, title`,
								[itemId],
							)) as Array<{ id: string }>
						).map((row) => row.id);
			if (!trackIds.length) {
				throw new BadRequest("This album has no songs to add.");
			}
			const [{ count, next }] = (await manager.query(
				`SELECT COUNT(*)::int AS count, COALESCE(MAX(position) + 1, 0)::int AS next FROM playlist_items WHERE playlist_id = $1`,
				[id],
			)) as Array<{ count: number; next: number }>;
			const existing = new Set(
				(
					(await manager.query(`SELECT item_id FROM playlist_items WHERE playlist_id = $1`, [id])) as Array<{
						item_id: string;
					}>
				).map((row) => row.item_id),
			);
			const fresh = trackIds.filter((trackId) => !existing.has(trackId));
			if (count + fresh.length > MAX_TRACKS) {
				throw new BadRequest(`A playlist can hold up to ${MAX_TRACKS} songs.`);
			}
			if (fresh.length) {
				await manager.query(
					`INSERT INTO playlist_items (playlist_id, item_id, position) SELECT $1, v.item_id, $3 + v.ord - 1 FROM unnest($2::uuid[]) WITH ORDINALITY AS v(item_id, ord) ON CONFLICT DO NOTHING`,
					[id, fresh, next],
				);
			}
			await manager.query(`UPDATE playlists SET updated_at = now() WHERE id = $1`, [id]);
			return { added: fresh.length };
		});
	}

	async removeTrack(userId: string, id: string, itemId: string): Promise<void> {
		await this.requireOwned(userId, id);
		await this.dataSource.getRepository(PlaylistItem).delete({ playlistId: id, itemId });
		await this.dataSource.getRepository(Playlist).update({ id }, { updatedAt: new Date() });
	}

	/** Replaces the order; `itemIds` must be exactly the songs now in the playlist. */
	async reorder(userId: string, id: string, itemIds: string[]): Promise<void> {
		await this.requireOwned(userId, id);
		await this.dataSource.transaction(async (manager) => {
			await manager.query(`SELECT 1 FROM playlists WHERE id = $1 FOR UPDATE`, [id]);
			const current = (await manager.query(`SELECT item_id FROM playlist_items WHERE playlist_id = $1`, [
				id,
			])) as Array<{ item_id: string }>;
			const wanted = new Set(itemIds);
			if (
				wanted.size !== itemIds.length ||
				wanted.size !== current.length ||
				current.some((row) => !wanted.has(row.item_id))
			) {
				throw new BadRequest("The order must list every song in the playlist exactly once.");
			}
			await manager.query(
				`UPDATE playlist_items p SET position = v.ord - 1 FROM unnest($2::uuid[]) WITH ORDINALITY AS v(item_id, ord) WHERE p.playlist_id = $1 AND p.item_id = v.item_id`,
				[id, itemIds],
			);
			await manager.query(`UPDATE playlists SET updated_at = now() WHERE id = $1`, [id]);
		});
	}

	/** The user's own playlists that already hold the song. */
	async containing(userId: string, itemId: string): Promise<string[]> {
		const rows = (await this.dataSource.query(
			`SELECT p.id FROM playlists p JOIN playlist_items pi ON pi.playlist_id = p.id WHERE p.user_id = $1 AND pi.item_id = $2`,
			[userId, itemId],
		)) as Array<{ id: string }>;
		return rows.map((row) => row.id);
	}

	private cleanDescription(value: string | null | undefined): string | null {
		const text = value?.trim();
		if (text && text.length > 500) {
			throw new BadRequest("The description can be up to 500 characters.");
		}
		return text || null;
	}

	private async requireOwned(userId: string, id: string): Promise<Playlist> {
		const playlist = await this.dataSource.getRepository(Playlist).findOneBy({ id, userId });
		if (!playlist) {
			throw new NotFound("Playlist not found.");
		}
		return playlist;
	}

	private async ownerVisible(viewerId: string, ownerId: string): Promise<boolean> {
		const rows = (await this.dataSource.query(
			`SELECT COALESCE(profile_visibility, 'public') AS visibility FROM user_preferences WHERE user_id = $1`,
			[ownerId],
		)) as Array<{ visibility: "public" | "hidden" | "friends" }>;
		const visibility = rows[0]?.visibility ?? "public";
		if (visibility === "public" || viewerId === ownerId) return true;
		if (visibility === "hidden") return false;
		const friendship = (await this.dataSource.query(
			`SELECT 1 FROM social_friendships WHERE accepted_at IS NOT NULL
			AND ((user_low_id = $1 AND user_high_id = $2) OR (user_low_id = $2 AND user_high_id = $1))`,
			[viewerId, ownerId],
		)) as unknown[];
		return friendship.length > 0;
	}

	/** Song counts, total length, cover and owner for a set of playlists, using a handful of queries however many there are. */
	private async summaries(playlists: Playlist[]): Promise<PlaylistSummary[]> {
		if (playlists.length === 0) {
			return [];
		}
		const ids = playlists.map((playlist) => playlist.id);
		const ownerIds = [...new Set(playlists.map((playlist) => playlist.userId))];

		const [stats, firsts, owners] = await Promise.all([
			this.dataSource.query(
				`SELECT pi.playlist_id, COUNT(*)::int AS n,
					COALESCE(SUM(CASE WHEN (m.technical->>'duration') ~ '^[0-9]+(\\.[0-9]+)?$' THEN (m.technical->>'duration')::numeric ELSE 0 END), 0)::float AS dur
				FROM playlist_items pi JOIN media_items m ON m.id = pi.item_id
				WHERE pi.playlist_id = ANY($1::uuid[]) GROUP BY pi.playlist_id`,
				[ids],
			) as Promise<Array<{ playlist_id: string; n: number; dur: number }>>,
			this.dataSource.query(
				`SELECT DISTINCT ON (playlist_id) playlist_id, item_id FROM playlist_items WHERE playlist_id = ANY($1::uuid[]) ORDER BY playlist_id, position ASC`,
				[ids],
			) as Promise<Array<{ playlist_id: string; item_id: string }>>,
			this.dataSource.query(
				`SELECT u.id, u.username, u.display_name, up.avatar_file FROM users u LEFT JOIN user_preferences up ON up.user_id = u.id WHERE u.id = ANY($1::uuid[])`,
				[ownerIds],
			) as Promise<OwnerRow[]>,
		]);

		const cards = await loadSocialItems(
			this.dataSource,
			firsts.map((row) => row.item_id),
		);
		const coverByItem = new Map(cards.map((card) => [card.id, card]));
		const statByPlaylist = new Map(stats.map((row) => [row.playlist_id, row]));
		const firstByPlaylist = new Map(firsts.map((row) => [row.playlist_id, row.item_id]));
		const ownerById = new Map(owners.map((row) => [row.id, row]));

		return playlists.map((playlist) => {
			const stat = statByPlaylist.get(playlist.id);
			const first = coverByItem.get(firstByPlaylist.get(playlist.id) ?? "");
			const owner = ownerById.get(playlist.userId);
			return {
				id: playlist.id,
				name: playlist.name,
				description: playlist.description,
				isPublic: playlist.isPublic,
				trackCount: stat?.n ?? 0,
				durationSeconds: Math.round(stat?.dur ?? 0),
				cover:
					first && first.imageIndex !== null
						? { itemId: first.imageItemId, index: first.imageIndex, updatedAt: first.imageUpdatedAt }
						: null,
				owner: {
					username: owner?.username ?? "",
					displayName: owner?.display_name ?? owner?.username ?? "",
					avatarUrl: owner?.avatar_file ? `/auth/avatars/${owner.avatar_file}` : null,
				},
				updatedAt: playlist.updatedAt,
			};
		});
	}
}
