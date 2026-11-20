import { randomUUID } from "node:crypto";
import { Inject, Injectable, logger } from "@tsed/di";
import { BadRequest, NotFound } from "@tsed/exceptions";
import { DataSource, IsNull, Not } from "typeorm";
import { DefaultDataSource } from "../../datasources/defaultDataSource.datasource.js";
import { SocialFriendInvite, SocialFriendship } from "../../entities/social.entity.js";
import { User } from "../../entities/user.entity.js";
import { UserPreference } from "../../entities/userPreference.entity.js";
import { NotificationService } from "../notifications/notificationService.js";
import type { CreateFriendInviteRequest } from "./socialRequests.js";

type FriendshipStatus = "self" | "none" | "outgoing" | "incoming" | "friends";

export interface FriendPerson {
	id: string;
	username: string;
	displayName: string;
	avatarUrl: string | null;
}

interface FriendshipRow {
	user_low_id: string;
	user_high_id: string;
	requested_by: string;
	accepted_at: Date | null;
}

interface UserRow {
	id: string;
	username: string;
	display_name: string | null;
	avatar_file: string | null;
}

const avatarUrl = (file: string | null) => (file ? `/auth/avatars/${file}` : null);
const pair = (a: string, b: string): [string, string] => (a < b ? [a, b] : [b, a]);

@Injectable()
export class FriendsService {

	constructor(
		@Inject(DefaultDataSource) private readonly dataSource: DataSource,
		private readonly notifications: NotificationService,
	) {}

	async list(userId: string) {
		const rows = await this.dataSource.getRepository(SocialFriendship).createQueryBuilder("f").innerJoin(User, "u", "u.id = CASE WHEN f.userLowId = :userId THEN f.userHighId ELSE f.userLowId END", { userId }).leftJoin(UserPreference, "up", "up.userId = u.id").select("f.userLowId", "user_low_id").addSelect("f.userHighId", "user_high_id").addSelect("f.requestedBy", "requested_by").addSelect("f.acceptedAt", "accepted_at").addSelect("u.id", "id").addSelect("u.username", "username").addSelect("u.displayName", "display_name").addSelect("up.avatarFile", "avatar_file").where("(f.userLowId = :userId OR f.userHighId = :userId)", { userId }).andWhere("u.disabledAt IS NULL").orderBy("LOWER(COALESCE(u.displayName, u.username))", "ASC").getRawMany<FriendshipRow & UserRow>();
		const friends: FriendPerson[] = [];
		const incoming: FriendPerson[] = [];
		const outgoing: FriendPerson[] = [];
		for (const row of rows) {
			const person = this.person(row);
			if (row.accepted_at) friends.push(person);
			else if (row.requested_by === userId) outgoing.push(person);
			else incoming.push(person);
		}
		return { friends, incoming, outgoing };
	}

	async status(viewerId: string, otherId: string): Promise<FriendshipStatus> {
		if (viewerId === otherId) return "self";
		const [low, high] = pair(viewerId, otherId);
		const row = await this.dataSource.getRepository(SocialFriendship).findOne({ select: { requestedBy: true, acceptedAt: true }, where: { userLowId: low, userHighId: high } });
		if (!row) return "none";
		if (row.acceptedAt) return "friends";
		return row.requestedBy === viewerId ? "outgoing" : "incoming";
	}

	async areFriends(firstId: string, secondId: string): Promise<boolean> {
		if (firstId === secondId) return true;
		const [low, high] = pair(firstId, secondId);
		return this.dataSource.getRepository(SocialFriendship).existsBy({ userLowId: low, userHighId: high, acceptedAt: Not(IsNull()) });
	}

	async request(userId: string, username: string) {
		const target = await this.findUser(username);
		if (!target) throw new NotFound("Person not found.");
		return this.requestTarget(userId, target);
	}

	async createInvite(viewerId: string, username: string, options: CreateFriendInviteRequest) {
		const target = await this.findUser(username);
		if (!target || target.id !== viewerId) throw new NotFound("Person not found.");

		const expiresInHours = options.expiresInHours;
		if (options.mode === "expires" && (typeof expiresInHours !== "number" || !Number.isInteger(expiresInHours) || expiresInHours < 1 || expiresInHours > 8760)) {
			throw new BadRequest("Choose a valid invite expiration.");
		}
		const expiresAt = options.mode === "expires" && expiresInHours ? new Date(Date.now() + expiresInHours * 60 * 60 * 1000) : null;
		const maxUses = options.mode === "once" ? 1 : null;
		const token = randomUUID();
		await this.dataSource.getRepository(SocialFriendInvite).insert({ token, ownerId: viewerId, maxUses, expiresAt });
		return { token, expiresAt };
	}

	async getInvite(viewerId: string, token: string) {
		const target = await this.findUserByInviteToken(token);
		if (!target) throw new NotFound("Friend invite not found.");
		return {
			username: target.username,
			displayName: target.display_name ?? target.username,
			avatarUrl: avatarUrl(target.avatar_file),
			friendship: await this.status(viewerId, target.id),
		};
	}

	async acceptInvite(userId: string, token: string) {
		if (!/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(token)) {
			throw new NotFound("Friend invite not found.");
		}
		return this.dataSource.transaction(async (manager) => {
			const invite = await manager.getRepository(SocialFriendInvite).createQueryBuilder("invite").innerJoin(User, "owner", "owner.id = invite.ownerId").select("invite.ownerId", "owner_id").addSelect("invite.maxUses", "max_uses").addSelect("invite.useCount", "use_count").addSelect("invite.expiresAt", "expires_at").where("invite.token = :token", { token: token.toLowerCase() }).andWhere("owner.disabledAt IS NULL").andWhere("(invite.expiresAt IS NULL OR invite.expiresAt > now())").andWhere("(invite.maxUses IS NULL OR invite.useCount < invite.maxUses)").setLock("pessimistic_write", undefined, ["invite"]).getRawOne<{ owner_id: string; max_uses: number | null; use_count: number; expires_at: Date | null }>();
			if (!invite) throw new NotFound("Friend invite not found.");
			if (invite.owner_id === userId) throw new BadRequest("You cannot add yourself as a friend.");
			const [low, high] = pair(userId, invite.owner_id);
			// RAW SQL: ON CONFLICT DO UPDATE with COALESCE and DB-side now()
			await manager.query(
				`INSERT INTO social_friendships (user_low_id, user_high_id, requested_by, accepted_at)
				VALUES ($1, $2, $3, now())
				ON CONFLICT (user_low_id, user_high_id) DO UPDATE
					SET accepted_at = COALESCE(social_friendships.accepted_at, now())`,
				[low, high, userId],
			);
			await manager.increment(SocialFriendInvite, { token: token.toLowerCase() }, "useCount", 1);
			return { status: "friends" as const };
		});
	}

	private async requestTarget(userId: string, target: UserRow) {
		if (target.id === userId) throw new BadRequest("You cannot add yourself as a friend.");
		const previousStatus = await this.status(userId, target.id);
		const requester = previousStatus === "none" ? await this.findUserById(userId) : undefined;
		const [low, high] = pair(userId, target.id);
		// RAW SQL: ON CONFLICT DO UPDATE with CASE and RETURNING
		const rows = (await this.dataSource.query(
			`INSERT INTO social_friendships (user_low_id, user_high_id, requested_by)
			VALUES ($1, $2, $3)
			ON CONFLICT (user_low_id, user_high_id) DO UPDATE
				SET accepted_at = CASE
					WHEN social_friendships.accepted_at IS NOT NULL THEN social_friendships.accepted_at
					WHEN social_friendships.requested_by <> EXCLUDED.requested_by THEN now()
					ELSE NULL
				END
			RETURNING requested_by, accepted_at`,
			[low, high, userId],
		)) as Array<Pick<FriendshipRow, "requested_by" | "accepted_at">>;
		const status = rows[0]?.accepted_at ? "friends" : rows[0]?.requested_by === userId ? "outgoing" : "incoming";
		if (status === "outgoing" && previousStatus === "none") {
			if (!requester) throw new NotFound("Person not found.");
			await this.notifications
				.send(
					{
						kind: "friend_request",
						title: "Friend request",
						body: `${requester.display_name || requester.username} sent you a friend request.`,
						url: `/u/${encodeURIComponent(requester.username)}`,
					},
					[target.id],
				)
				.catch((error: unknown) => logger().warn("Could not notify the user about a friend request.", error));
		}
		return {
			status,
		} as const;
	}

	async accept(userId: string, username: string) {
		const target = await this.findUser(username);
		if (!target) throw new NotFound("Person not found.");
		const [low, high] = pair(userId, target.id);
		const result = await this.dataSource
			.getRepository(SocialFriendship)
			.createQueryBuilder()
			.update(SocialFriendship)
			.set({ acceptedAt: () => "now()" })
			.where('"user_low_id" = :low AND "user_high_id" = :high AND "accepted_at" IS NULL AND "requested_by" <> :userId', { low, high, userId })
			.execute();
		if (!result.affected) {
			const status = await this.status(userId, target.id);
			if (status !== "friends") throw new BadRequest("There is no friend request to accept.");
		}
		return { status: "friends" as const };
	}

	async remove(userId: string, username: string): Promise<void> {
		const target = await this.findUser(username);
		if (!target) throw new NotFound("Person not found.");
		const [low, high] = pair(userId, target.id);
		await this.dataSource.getRepository(SocialFriendship).delete({ userLowId: low, userHighId: high });
	}

	private async findUser(username: string): Promise<UserRow | undefined> {
		return this.userLookup()
			.where("LOWER(u.username) = LOWER(:username)", { username: username.slice(0, 64) })
			.andWhere("u.disabledAt IS NULL")
			.getRawOne<UserRow>();
	}

	private async findUserById(id: string): Promise<UserRow | undefined> {
		return this.userLookup().where("u.id = :id", { id }).andWhere("u.disabledAt IS NULL").getRawOne<UserRow>();
	}

	private userLookup() {
		return this.dataSource.getRepository(User).createQueryBuilder("u").leftJoin(UserPreference, "up", "up.userId = u.id").select("u.id", "id").addSelect("u.username", "username").addSelect("u.displayName", "display_name").addSelect("up.avatarFile", "avatar_file");
	}

	private async findUserByInviteToken(token: string): Promise<UserRow | undefined> {
		if (!/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(token)) return undefined;
		return this.userLookup().innerJoin(SocialFriendInvite, "invite", "invite.ownerId = u.id").where("invite.token = :token", { token: token.toLowerCase() }).andWhere("u.disabledAt IS NULL").andWhere("(invite.expiresAt IS NULL OR invite.expiresAt > now())").andWhere("(invite.maxUses IS NULL OR invite.useCount < invite.maxUses)").getRawOne<UserRow>();
	}

	private person(row: UserRow): FriendPerson {
		return {
			id: row.id,
			username: row.username,
			displayName: row.display_name ?? row.username,
			avatarUrl: avatarUrl(row.avatar_file),
		};
	}
}
