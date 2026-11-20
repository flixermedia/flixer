// Runs the converted social services (friends, playlists, collections, queue, watch later, feedback) against a migrated throwaway schema:
//   ENTITY_SCHEMA_TEST_DATABASE_URL=postgres://... npx vitest run src/api/social/socialEntitiesPostgres.spec.ts
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { DataSource } from "typeorm";
import { Favorite } from "../../entities/favorite.entity.js";
import { ListeningHistory } from "../../entities/listeningHistory.entity.js";
import { MediaItem } from "../../entities/mediaItem.entity.js";
import { MediaLibrary } from "../../entities/mediaLibrary.entity.js";
import { Playlist } from "../../entities/playlist.entity.js";
import { SocialFriendInvite, SocialFriendship } from "../../entities/social.entity.js";
import { User } from "../../entities/user.entity.js";
import { UpNextQueueItem, WatchLaterItem } from "../../entities/userMediaQueue.entity.js";
import { UserPreference } from "../../entities/userPreference.entity.js";
import { VideoCollection, VideoCollectionItem } from "../../entities/videoCollection.entity.js";
import type { MediaAccessService } from "../access/mediaAccessService.js";
import type { NotificationService } from "../notifications/notificationService.js";
import { FriendsService } from "./friendsService.js";
import { PlaylistsService } from "./playlistsService.js";
import { UserMediaService } from "./userMediaService.js";
import { ProfilesService } from "./profilesService.js";
import { HEAVY_HOOK_TIMEOUT, createIsolatedSchema, type IsolatedSchema } from "../../datasources/testPostgres.js";

const databaseUrl = process.env.ENTITY_SCHEMA_TEST_DATABASE_URL;

describe.skipIf(!databaseUrl)("social entities with PostgreSQL", () => {
	// Sorted so the friendship check constraint (low < high) is satisfied by (alex, sam).
	const [alex, sam, kim] = [randomUUID(), randomUUID(), randomUUID()].sort();
	const library = randomUUID();
	const movies = [randomUUID(), randomUUID(), randomUUID()];
	const tracks = [randomUUID(), randomUUID()];
	const album = randomUUID();
	let isolated: IsolatedSchema;
	let db: DataSource;
	let friends: FriendsService;
	let playlists: PlaylistsService;
	let media: UserMediaService;
	const send = vi.fn(async () => ({ recipients: 1, pushed: 0 }));

	beforeAll(async () => {
		isolated = await createIsolatedSchema(databaseUrl as string, { prefix: "social_entities_test" });
		db = isolated.db;
		await db.getRepository(MediaLibrary).save({ id: library, name: "Library", type: "mixed" });
		await db.getRepository(User).save([
			{ id: alex, username: "alex", displayName: "Alex", passwordHash: "unused" },
			{ id: sam, username: "sam", displayName: "Sam", passwordHash: "unused" },
			{ id: kim, username: "kim", passwordHash: "unused" },
		]);
		const items = [...movies.map((id, index) => ({ id, type: "movie" as const, title: `Movie ${index}`, externalKey: `movie-${index}` })), { id: album, type: "album" as const, title: "Album", externalKey: "album" }, ...tracks.map((id, index) => ({ id, parentId: album, type: "track" as const, title: `Track ${index}`, externalKey: `track-${index}` }))];
		await db.getRepository(MediaItem).save(items.map((item) => ({ libraryId: library, path: `/${item.externalKey}`, ...item })));
		friends = new FriendsService(db, { send } as unknown as NotificationService);
		playlists = new PlaylistsService(db);
		media = new UserMediaService(db, { restrict: vi.fn() } as unknown as MediaAccessService);
	}, HEAVY_HOOK_TIMEOUT);

	afterAll(async () => {
		await isolated?.drop();
	});

	it("runs the friend request, accept and remove flow", async () => {
		expect(await friends.status(alex, sam)).toBe("none");
		expect(await friends.areFriends(alex, sam)).toBe(false);
		expect(await friends.status(alex, alex)).toBe("self");

		expect(await friends.request(alex, "sam")).toEqual({ status: "outgoing" });
		expect(send).toHaveBeenCalledTimes(1);
		expect(await friends.status(alex, sam)).toBe("outgoing");
		expect(await friends.status(sam, alex)).toBe("incoming");
		expect(await friends.list(sam)).toMatchObject({ friends: [], incoming: [{ username: "alex", displayName: "Alex" }], outgoing: [] });
		expect(await friends.list(alex)).toMatchObject({ outgoing: [{ username: "sam" }] });
		await expect(friends.accept(alex, "sam")).rejects.toThrow("There is no friend request to accept.");

		expect(await friends.accept(sam, "alex")).toEqual({ status: "friends" });
		expect(await friends.accept(sam, "alex")).toEqual({ status: "friends" });
		expect(await friends.areFriends(sam, alex)).toBe(true);
		expect(await friends.status(alex, sam)).toBe("friends");
		expect(await friends.list(alex)).toMatchObject({ friends: [{ username: "sam" }], incoming: [], outgoing: [] });
		const row = await db.getRepository(SocialFriendship).findOneByOrFail({ userLowId: alex, userHighId: sam });
		expect(row).toMatchObject({ requestedBy: alex });
		expect(row.acceptedAt).toBeInstanceOf(Date);

		await friends.remove(alex, "sam");
		expect(await friends.status(alex, sam)).toBe("none");
		expect(await db.getRepository(SocialFriendship).count()).toBe(0);
		await expect(friends.accept(sam, "alex")).rejects.toThrow("There is no friend request to accept.");
	});

	it("filters the profile directory and returns correlated counts", async () => {
		await db.getRepository(UserPreference).save({ userId: sam, profileVisibility: "friends" });
		await db.getRepository(SocialFriendship).save({ userLowId: alex, userHighId: sam, requestedBy: alex, acceptedAt: new Date() });
		await db.getRepository(Favorite).save({ userId: sam, itemId: movies[0] });
		await db.getRepository(Playlist).save({ id: randomUUID(), userId: sam, name: "Public", isPublic: true });
		await db.getRepository(Playlist).save({ id: randomUUID(), userId: sam, name: "Private", isPublic: false });
		await db.getRepository(ListeningHistory).save({ userId: sam, itemId: tracks[0], playCount: 4 });
		const profiles = new ProfilesService(db, {} as never, {} as never, {} as never);
		expect(await profiles.directory(alex, "sam")).toMatchObject({ profiles: [{ username: "sam", favoriteCount: 1, playlistCount: 1, playCount: 4, nowPlaying: null }] });
		await db.getRepository(UserPreference).update({ userId: sam }, { profileVisibility: "hidden" });
		expect(await profiles.directory(alex, "sam")).toEqual({ profiles: [] });
		await db.getRepository(SocialFriendship).delete({ userLowId: alex, userHighId: sam });
	});

	it("creates and consumes invites", async () => {
		const once = await friends.createInvite(kim, "kim", { mode: "once" });
		expect(once.expiresAt).toBeNull();
		expect(await db.getRepository(SocialFriendInvite).findOneByOrFail({ token: once.token })).toMatchObject({ ownerId: kim, maxUses: 1, useCount: 0, expiresAt: null });
		expect(await friends.getInvite(alex, once.token)).toMatchObject({ username: "kim", friendship: "none" });

		expect(await friends.acceptInvite(alex, once.token)).toEqual({ status: "friends" });
		expect((await db.getRepository(SocialFriendInvite).findOneByOrFail({ token: once.token })).useCount).toBe(1);
		expect(await friends.areFriends(alex, kim)).toBe(true);
		await expect(friends.acceptInvite(sam, once.token)).rejects.toThrow(/not found/i);

		const timed = await friends.createInvite(kim, "kim", { mode: "expires", expiresInHours: 2 });
		expect(timed.expiresAt).toBeInstanceOf(Date);
		const stored = await db.getRepository(SocialFriendInvite).findOneByOrFail({ token: timed.token });
		expect(stored.maxUses).toBeNull();
		expect(stored.expiresAt?.getTime()).toBe(timed.expiresAt?.getTime());
		await expect(friends.acceptInvite(kim, timed.token)).rejects.toThrow(/yourself/i);
		await friends.remove(alex, "kim");
	});

	it("manages playlists and honours profile visibility between friends", async () => {
		const created = await playlists.create(alex, { name: "Road trip", isPublic: true });
		expect(await playlists.addTrack(alex, created.id, album)).toEqual({ added: 2 });
		expect(await playlists.addTrack(alex, created.id, tracks[0])).toEqual({ added: 0 });
		expect(await playlists.containing(alex, tracks[1])).toEqual([created.id]);
		await playlists.reorder(alex, created.id, [tracks[1], tracks[0]]);
		expect((await playlists.get(alex, created.id)).tracks.map((track) => track.id)).toEqual([tracks[1], tracks[0]]);
		await playlists.removeTrack(alex, created.id, tracks[0]);
		expect(await playlists.containing(alex, tracks[0])).toEqual([]);

		await db.getRepository(UserPreference).save({ userId: alex, profileVisibility: "friends" });
		await expect(playlists.get(sam, created.id)).rejects.toThrow(/not found/i);
		await db.getRepository(SocialFriendship).insert({ userLowId: alex, userHighId: sam, requestedBy: sam, acceptedAt: new Date() });
		expect((await playlists.get(sam, created.id)).tracks).toHaveLength(1);
		await db.getRepository(SocialFriendship).delete({ userLowId: alex, userHighId: sam });
		await playlists.remove(alex, created.id);
	});

	it("keeps a watch later list", async () => {
		await media.addWatchLater(alex, movies[0]);
		await media.addWatchLater(alex, movies[0]);
		await media.addWatchLater(alex, movies[1]);
		await expect(media.addWatchLater(alex, tracks[0])).rejects.toThrow(/video items/i);
		await expect(media.addWatchLater(alex, randomUUID())).rejects.toThrow(/not found/i);
		expect((await media.watchLaterIds(alex)).sort()).toEqual([movies[0], movies[1]].sort());
		expect((await media.watchLater(alex)).map((item) => item.id)).toEqual([movies[1], movies[0]]);
		expect(await media.watchLaterIds(sam)).toEqual([]);
		await media.removeWatchLater(alex, movies[0]);
		expect(await media.watchLaterIds(alex)).toEqual([movies[1]]);
		await db.getRepository(WatchLaterItem).delete({ userId: alex });
	});

	it("manages video collections end to end", async () => {
		const created = await media.createCollection(alex, { name: " Favourites ", description: " Best ", isPublic: true });
		expect(created).toMatchObject({ name: "Favourites", description: "Best", isPublic: true, itemCount: 0 });
		expect(created.createdAt).toBeInstanceOf(Date);
		expect(created.updatedAt).toBeInstanceOf(Date);
		await expect(media.createCollection(alex, { name: "" })).rejects.toThrow(/1 to 100/);

		await media.addCollectionItem(alex, created.id, movies[0]);
		await media.addCollectionItem(alex, created.id, movies[1]);
		await media.addCollectionItem(alex, created.id, movies[1]);
		await media.addCollectionItem(alex, created.id, movies[2]);
		await expect(media.addCollectionItem(sam, created.id, movies[0])).rejects.toThrow(/not found/i);
		expect((await media.collection(alex, created.id)).items.map((item) => item.id)).toEqual(movies);

		await media.reorderCollection(alex, created.id, [movies[2], movies[0], movies[1]]);
		expect((await media.collection(alex, created.id)).items.map((item) => item.id)).toEqual([movies[2], movies[0], movies[1]]);
		await expect(media.reorderCollection(alex, created.id, [movies[2]])).rejects.toThrow(/every collection item/i);
		await expect(media.reorderCollection(sam, created.id, [])).rejects.toThrow(/not found/i);

		await media.removeCollectionItem(alex, created.id, movies[0]);
		expect(await db.getRepository(VideoCollectionItem).countBy({ collectionId: created.id })).toBe(2);
		expect(await media.updateCollection(alex, created.id, { name: "Renamed", isPublic: false })).toMatchObject({ id: created.id, name: "Renamed", description: "Best", isPublic: false, itemCount: 2, createdAt: expect.any(Date), updatedAt: expect.any(Date) });
		const stored = await db.getRepository(VideoCollection).findOneByOrFail({ id: created.id });
		expect(stored).toMatchObject({ name: "Renamed", description: "Best", isPublic: false });
		expect(stored.updatedAt.getTime()).toBeGreaterThanOrEqual(created.updatedAt.getTime());

		const listed = await media.collections(alex, {} as never);
		expect(listed).toMatchObject([{ id: created.id, name: "Renamed", itemCount: 2, visibleItemCount: 2 }]);
		await expect(media.collection(sam, created.id)).rejects.toThrow(/not found/i);
		await expect(media.updateCollection(sam, created.id, { name: "Hijack" })).rejects.toThrow(/not found/i);

		await media.deleteCollection(sam, created.id);
		expect(await db.getRepository(VideoCollection).countBy({ id: created.id })).toBe(1);
		await media.deleteCollection(alex, created.id);
		expect(await db.getRepository(VideoCollection).countBy({ id: created.id })).toBe(0);
		expect(await db.getRepository(VideoCollectionItem).countBy({ collectionId: created.id })).toBe(0);
	});

	it("manages the up next queue", async () => {
		await media.addToQueue(alex, movies[0]);
		await media.addToQueue(alex, movies[1]);
		await media.addToQueue(alex, movies[1]);
		await media.addToQueue(alex, movies[2]);
		await expect(media.addToQueue(alex, tracks[0])).rejects.toThrow(/video items/i);
		expect((await media.queue(alex)).map((item) => item.id)).toEqual(movies);
		expect(await media.queue(sam)).toEqual([]);

		await media.reorderQueue(alex, [movies[1], movies[2], movies[0]]);
		expect((await media.queue(alex)).map((item) => item.id)).toEqual([movies[1], movies[2], movies[0]]);
		await expect(media.reorderQueue(alex, [movies[1]])).rejects.toThrow(/every queued item/i);

		await media.removeFromQueue(sam, movies[1]);
		expect(await db.getRepository(UpNextQueueItem).countBy({ userId: alex })).toBe(3);
		await media.removeFromQueue(alex, movies[1]);
		expect((await media.queue(alex)).map((item) => item.id)).toEqual([movies[2], movies[0]]);
		await media.clearQueue(alex);
		expect(await media.queue(alex)).toEqual([]);
	});

	it("stores recommendation feedback", async () => {
		await media.setRecommendationFeedback(alex, movies[0], "dismiss");
		await media.setRecommendationFeedback(alex, movies[1], "more_like_this");
		await media.setRecommendationFeedback(alex, movies[2], "dismiss");
		await media.setRecommendationFeedback(alex, movies[2], "less_like_this");
		await media.setRecommendationFeedback(alex, movies[1], "dismiss");
		await expect(media.setRecommendationFeedback(alex, tracks[0], "dismiss")).rejects.toThrow(/not found/i);
		expect((await media.dismissedRecommendations(alex)).sort()).toEqual([movies[0], movies[1]].sort());
		expect((await media.dismissedRecommendationItems(alex)).map((item) => item.id)).toEqual([movies[1], movies[0]]);
		await media.clearRecommendationFeedback(alex, movies[0]);
		expect(await media.dismissedRecommendations(alex)).toEqual([movies[1]]);
		expect(await media.dismissedRecommendations(sam)).toEqual([]);
	});
});
