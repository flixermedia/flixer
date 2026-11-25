import { Inject, Injectable } from "@tsed/di";
import { BadRequest, NotFound } from "@tsed/exceptions";
import { randomUUID } from "node:crypto";
import { DataSource, IsNull, Not } from "typeorm";
import { DefaultDataSource } from "../../datasources/defaultDataSource.datasource.js";
import { rlsManager, rlsRepo } from "../../datasources/rlsContext.js";
import { MediaItem } from "../../entities/mediaItem.entity.js";
import { Playlist } from "../../entities/playlist.entity.js";
import { PlaylistItem } from "../../entities/playlistItem.entity.js";
import { SocialFriendship } from "../../entities/social.entity.js";
import { User } from "../../entities/user.entity.js";
import { UserPreference } from "../../entities/userPreference.entity.js";
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
		const rows = await rlsRepo(this.dataSource, Playlist).find({ where: { userId }, order: { updatedAt: "DESC" } });
		return this.summaries(rows);
	}

	/** Playlists others may see on a profile: the public ones, or all of them for the owner. */
	async listForProfile(ownerId: string, includePrivate: boolean): Promise<PlaylistSummary[]> {
		const rows = await rlsRepo(this.dataSource, Playlist).find({
			where: includePrivate ? { userId: ownerId } : { userId: ownerId, isPublic: true },
			order: { updatedAt: "DESC" },
		});
		return this.summaries(rows);
	}

	async create(userId: string, input: { name: string; description?: string | null; isPublic?: boolean }): Promise<PlaylistSummary> {
		const name = input.name?.trim();
		if (!name || name.length > 100) {
			throw new BadRequest("Playlist name must be 1 to 100 characters.");
		}
		const description = this.cleanDescription(input.description);
		const repo = rlsRepo(this.dataSource, Playlist);
		if ((await repo.countBy({ userId })) >= MAX_PLAYLISTS) {
			throw new BadRequest(`You can have up to ${MAX_PLAYLISTS} playlists.`);
		}
		const playlist = await repo.save(repo.create({ id: randomUUID(), userId, name, description, isPublic: input.isPublic ?? true }));
		return (await this.summaries([playlist]))[0];
	}

	async update(userId: string, id: string, changes: { name?: string; description?: string | null; isPublic?: boolean }): Promise<PlaylistSummary> {
		const repo = rlsRepo(this.dataSource, Playlist);
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
		await rlsRepo(this.dataSource, Playlist).delete({ id, userId });
	}

	/** One playlist with its songs, for its owner or, when public, anyone whose owner has not hidden their profile. */
	async get(viewerId: string, id: string) {
		const playlist = await rlsRepo(this.dataSource, Playlist).findOneBy({ id });
		if (!playlist) {
			throw new NotFound("Playlist not found.");
		}
		const isOwner = playlist.userId === viewerId;
		if (!isOwner && (!playlist.isPublic || !(await this.ownerVisible(viewerId, playlist.userId)))) {
			throw new NotFound("Playlist not found.");
		}

		const entries = await rlsRepo(this.dataSource, PlaylistItem).find({ where: { playlistId: id }, order: { position: "ASC", addedAt: "ASC" } });
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
		const item = await this.dataSource.getRepository(MediaItem).findOne({ where: { id: itemId, isPlaceholder: false }, select: { id: true, type: true } });
		if (!item) {
			throw new NotFound("Media item not found.");
		}
		if (item.type !== "track" && item.type !== "album") {
			throw new BadRequest("Only songs and albums can be added to a playlist.");
		}
		return rlsManager(this.dataSource).transaction(async (manager) => {
			// Serialises concurrent adds so positions stay unique and the size cap holds.
			await manager.findOne(Playlist, { select: { id: true }, where: { id }, lock: { mode: "pessimistic_write" } });
			const trackIds =
				item.type === "track"
					? [itemId]
					: (
							await manager.find(MediaItem, {
								select: { id: true },
								where: { parentId: itemId, type: "track", isPlaceholder: false },
								order: { seasonNumber: { direction: "ASC", nulls: "FIRST" }, episodeNumber: { direction: "ASC", nulls: "LAST" }, sortTitle: { direction: "ASC", nulls: "LAST" }, title: "ASC" },
							})
						).map((row) => row.id);
			if (!trackIds.length) {
				throw new BadRequest("This album has no songs to add.");
			}
			const aggregate = await manager.getRepository(PlaylistItem).createQueryBuilder("entry").select("COUNT(*)::int", "count").addSelect("COALESCE(MAX(entry.position) + 1, 0)::int", "next").where("entry.playlistId = :id", { id }).getRawOne<{ count: number; next: number }>();
			const { count = 0, next = 0 } = aggregate ?? {};
			const existing = new Set((await manager.find(PlaylistItem, { select: { itemId: true }, where: { playlistId: id } })).map((row) => row.itemId));
			const fresh = trackIds.filter((trackId) => !existing.has(trackId));
			if (count + fresh.length > MAX_TRACKS) {
				throw new BadRequest(`A playlist can hold up to ${MAX_TRACKS} songs.`);
			}
			if (fresh.length) {
				await manager
					.createQueryBuilder()
					.insert()
					.into(PlaylistItem)
					.values(fresh.map((trackId, index) => ({ playlistId: id, itemId: trackId, position: next + index })))
					.orIgnore()
					.updateEntity(false)
					.execute();
			}
			await manager.update(Playlist, { id }, { updatedAt: () => "now()" });
			return { added: fresh.length };
		});
	}

	async removeTrack(userId: string, id: string, itemId: string): Promise<void> {
		await this.requireOwned(userId, id);
		await rlsRepo(this.dataSource, PlaylistItem).delete({ playlistId: id, itemId });
		await rlsRepo(this.dataSource, Playlist).update({ id }, { updatedAt: new Date() });
	}

	/** Replaces the order; `itemIds` must be exactly the songs now in the playlist. */
	async reorder(userId: string, id: string, itemIds: string[]): Promise<void> {
		await this.requireOwned(userId, id);
		await rlsManager(this.dataSource).transaction(async (manager) => {
			await manager.findOne(Playlist, { select: { id: true }, where: { id }, lock: { mode: "pessimistic_write" } });
			const current = await manager.find(PlaylistItem, { select: { itemId: true }, where: { playlistId: id } });
			const wanted = new Set(itemIds);
			if (wanted.size !== itemIds.length || wanted.size !== current.length || current.some((row) => !wanted.has(row.itemId))) {
				throw new BadRequest("The order must list every song in the playlist exactly once.");
			}
			// RAW SQL: PostgreSQL array_position maps the validated list order to positions.
			await manager
				.createQueryBuilder()
				.update(PlaylistItem)
				.set({ position: () => 'array_position(:itemIds::uuid[], "item_id") - 1' })
				.where('"playlist_id" = :id AND "item_id" = ANY(:itemIds::uuid[])', { id, itemIds })
				.execute();
			await manager.update(Playlist, { id }, { updatedAt: () => "now()" });
		});
	}

	/** The user's own playlists that already hold the song. */
	async containing(userId: string, itemId: string): Promise<string[]> {
		const rows = await rlsRepo(this.dataSource, Playlist).createQueryBuilder("p").innerJoin(PlaylistItem, "pi", "pi.playlistId = p.id").select("p.id", "id").where("p.userId = :userId", { userId }).andWhere("pi.itemId = :itemId", { itemId }).getRawMany<{ id: string }>();
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
		const playlist = await rlsRepo(this.dataSource, Playlist).findOneBy({ id, userId });
		if (!playlist) {
			throw new NotFound("Playlist not found.");
		}
		return playlist;
	}

	private async ownerVisible(viewerId: string, ownerId: string): Promise<boolean> {
		const preferences = await rlsRepo(this.dataSource, UserPreference).findOne({ select: { profileVisibility: true }, where: { userId: ownerId } });
		const visibility = preferences?.profileVisibility ?? "public";
		if (visibility === "public" || viewerId === ownerId) return true;
		if (visibility === "hidden") return false;
		return rlsRepo(this.dataSource, SocialFriendship).existsBy([
			{ userLowId: viewerId, userHighId: ownerId, acceptedAt: Not(IsNull()) },
			{ userLowId: ownerId, userHighId: viewerId, acceptedAt: Not(IsNull()) },
		]);
	}

	/** Song counts, total length, cover and owner for a set of playlists, using a handful of queries however many there are. */
	private async summaries(playlists: Playlist[]): Promise<PlaylistSummary[]> {
		if (playlists.length === 0) {
			return [];
		}
		const ids = playlists.map((playlist) => playlist.id);
		const ownerIds = [...new Set(playlists.map((playlist) => playlist.userId))];

		const [stats, firsts, owners] = await Promise.all([
			this.dataSource
				.getRepository(PlaylistItem)
				.createQueryBuilder("entry")
				.innerJoin(MediaItem, "item", "item.id = entry.itemId")
				.select("entry.playlistId", "playlist_id")
				.addSelect("COUNT(*)::int", "n")
				// RAW SQL: PostgreSQL JSONB extraction, regex validation and numeric conversion.
				.addSelect("COALESCE(SUM(CASE WHEN (item.technical->>'duration') ~ '^[0-9]+(\\.[0-9]+)?$' THEN (item.technical->>'duration')::numeric ELSE 0 END), 0)::float", "dur")
				.where("entry.playlistId IN (:...ids)", { ids })
				.groupBy("entry.playlistId")
				.getRawMany<{ playlist_id: string; n: number; dur: number }>(),
			this.dataSource.getRepository(PlaylistItem).createQueryBuilder("entry").distinctOn(["entry.playlistId"]).select("entry.playlistId", "playlist_id").addSelect("entry.itemId", "item_id").where("entry.playlistId IN (:...ids)", { ids }).orderBy("entry.playlistId", "ASC").addOrderBy("entry.position", "ASC").getRawMany<{ playlist_id: string; item_id: string }>(),
			this.dataSource.getRepository(User).createQueryBuilder("u").leftJoin(UserPreference, "up", "up.userId = u.id").select("u.id", "id").addSelect("u.username", "username").addSelect("u.displayName", "display_name").addSelect("up.avatarFile", "avatar_file").where("u.id IN (:...ownerIds)", { ownerIds }).getRawMany<OwnerRow>(),
		] as const);

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
				cover: first && first.imageIndex !== null ? { itemId: first.imageItemId, index: first.imageIndex, updatedAt: first.imageUpdatedAt } : null,
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
