import { randomUUID } from "node:crypto";
import { Inject, Injectable, logger } from "@tsed/di";
import { BadRequest, NotFound } from "@tsed/exceptions";
import { DataSource } from "typeorm";
import { DefaultDataSource } from "../../datasources/defaultDataSource.datasource.js";
import { NotificationService } from "../notifications/notificationService.js";
import type { CreateFriendInviteRequest } from "./socialRequests.js";

export type FriendshipStatus = "self" | "none" | "outgoing" | "incoming" | "friends";

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
		const rows = (await this.dataSource.query(
			`SELECT f.user_low_id, f.user_high_id, f.requested_by, f.accepted_at,
				u.id, u.username, u.display_name, up.avatar_file
			FROM social_friendships f
			JOIN users u ON u.id = CASE WHEN f.user_low_id = $1 THEN f.user_high_id ELSE f.user_low_id END
			LEFT JOIN user_preferences up ON up.user_id = u.id
			WHERE (f.user_low_id = $1 OR f.user_high_id = $1) AND u.disabled_at IS NULL
			ORDER BY lower(COALESCE(u.display_name, u.username))`,
			[userId],
		)) as Array<FriendshipRow & UserRow>;
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
		const rows = (await this.dataSource.query(
			`SELECT requested_by, accepted_at FROM social_friendships WHERE user_low_id = $1 AND user_high_id = $2`,
			[low, high],
		)) as Array<Pick<FriendshipRow, "requested_by" | "accepted_at">>;
		const row = rows[0];
		if (!row) return "none";
		if (row.accepted_at) return "friends";
		return row.requested_by === viewerId ? "outgoing" : "incoming";
	}

	async areFriends(firstId: string, secondId: string): Promise<boolean> {
		if (firstId === secondId) return true;
		const [low, high] = pair(firstId, secondId);
		const rows = (await this.dataSource.query(
			`SELECT 1 FROM social_friendships WHERE user_low_id = $1 AND user_high_id = $2 AND accepted_at IS NOT NULL`,
			[low, high],
		)) as unknown[];
		return rows.length > 0;
	}

	async request(userId: string, username: string) {
		const target = await this.findUser(username);
		if (!target) throw new NotFound("Person not found.");
		return this.requestTarget(userId, target);
	}

	async createInvite(viewerId: string, username: string, options: CreateFriendInviteRequest) {
		const target = await this.findUser(username);
		if (!target) throw new NotFound("Person not found.");
		if (target.id !== viewerId) {
			const rows = (await this.dataSource.query(
				`SELECT COALESCE(up.profile_visibility, 'public') AS visibility,
					EXISTS (
						SELECT 1 FROM social_friendships sf
						WHERE sf.accepted_at IS NOT NULL
						AND ((sf.user_low_id = $2 AND sf.user_high_id = u.id) OR (sf.user_high_id = $2 AND sf.user_low_id = u.id))
					) AS is_friend
				FROM users u LEFT JOIN user_preferences up ON up.user_id = u.id
				WHERE u.id = $1 AND u.disabled_at IS NULL`,
				[target.id, viewerId],
			)) as Array<{ visibility: "public" | "hidden" | "friends"; is_friend: boolean }>;
			const visibility = rows[0]?.visibility ?? "public";
			if (visibility === "hidden" || (visibility === "friends" && !rows[0]?.is_friend)) {
				throw new NotFound("Person not found.");
			}
		}

		const expiresInHours = options.expiresInHours;
		if (
			options.mode === "expires" &&
			(typeof expiresInHours !== "number" ||
				!Number.isInteger(expiresInHours) ||
				expiresInHours < 1 ||
				expiresInHours > 8760)
		) {
			throw new BadRequest("Choose a valid invite expiration.");
		}
		const expiresAt =
			options.mode === "expires" && expiresInHours
				? new Date(Date.now() + expiresInHours * 60 * 60 * 1000)
				: null;
		const maxUses = options.mode === "once" ? 1 : null;
		const rows = (await this.dataSource.query(
			`INSERT INTO social_friend_invites (token, owner_id, max_uses, expires_at)
			VALUES ($1, $2, $3, $4)
			RETURNING token, expires_at`,
			[randomUUID(), target.id, maxUses, expiresAt],
		)) as Array<{ token: string; expires_at: Date | null }>;
		if (!rows[0]) throw new NotFound("Person not found.");
		return { token: rows[0].token, expiresAt: rows[0].expires_at };
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
			const rows = (await manager.query(
				`SELECT invite.owner_id, invite.max_uses, invite.use_count, invite.expires_at
				FROM social_friend_invites invite
				JOIN users owner ON owner.id = invite.owner_id
				WHERE invite.token = $1 AND owner.disabled_at IS NULL
					AND (invite.expires_at IS NULL OR invite.expires_at > now())
					AND (invite.max_uses IS NULL OR invite.use_count < invite.max_uses)
				FOR UPDATE OF invite`,
				[token.toLowerCase()],
			)) as Array<{ owner_id: string; max_uses: number | null; use_count: number; expires_at: Date | null }>;
			const invite = rows[0];
			if (!invite) throw new NotFound("Friend invite not found.");
			if (invite.owner_id === userId) throw new BadRequest("You cannot add yourself as a friend.");
			const [low, high] = pair(userId, invite.owner_id);
			await manager.query(
				`INSERT INTO social_friendships (user_low_id, user_high_id, requested_by, accepted_at)
				VALUES ($1, $2, $3, now())
				ON CONFLICT (user_low_id, user_high_id) DO UPDATE
					SET accepted_at = COALESCE(social_friendships.accepted_at, now())`,
				[low, high, userId],
			);
			await manager.query(`UPDATE social_friend_invites SET use_count = use_count + 1 WHERE token = $1`, [
				token.toLowerCase(),
			]);
			return { status: "friends" as const };
		});
	}

	private async requestTarget(userId: string, target: UserRow) {
		if (target.id === userId) throw new BadRequest("You cannot add yourself as a friend.");
		const previousStatus = await this.status(userId, target.id);
		const requester = previousStatus === "none" ? await this.findUserById(userId) : undefined;
		const [low, high] = pair(userId, target.id);
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
		const rows = (await this.dataSource.query(
			`UPDATE social_friendships SET accepted_at = now()
			WHERE user_low_id = $1 AND user_high_id = $2 AND accepted_at IS NULL AND requested_by <> $3
			RETURNING accepted_at`,
			[low, high, userId],
		)) as unknown[];
		if (!rows.length) {
			const status = await this.status(userId, target.id);
			if (status !== "friends") throw new BadRequest("There is no friend request to accept.");
		}
		return { status: "friends" as const };
	}

	async remove(userId: string, username: string): Promise<void> {
		const target = await this.findUser(username);
		if (!target) throw new NotFound("Person not found.");
		const [low, high] = pair(userId, target.id);
		await this.dataSource.query(`DELETE FROM social_friendships WHERE user_low_id = $1 AND user_high_id = $2`, [
			low,
			high,
		]);
	}

	private async findUser(username: string): Promise<UserRow | undefined> {
		const rows = (await this.dataSource.query(
			`SELECT u.id, u.username, u.display_name, up.avatar_file
			FROM users u LEFT JOIN user_preferences up ON up.user_id = u.id
			WHERE lower(u.username) = lower($1) AND u.disabled_at IS NULL`,
			[username.slice(0, 64)],
		)) as UserRow[];
		return rows[0];
	}

	private async findUserById(id: string): Promise<UserRow | undefined> {
		const rows = (await this.dataSource.query(
			`SELECT u.id, u.username, u.display_name, up.avatar_file
			FROM users u LEFT JOIN user_preferences up ON up.user_id = u.id
			WHERE u.id = $1 AND u.disabled_at IS NULL`,
			[id],
		)) as UserRow[];
		return rows[0];
	}

	private async findUserByInviteToken(token: string): Promise<UserRow | undefined> {
		if (!/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(token)) return undefined;
		const rows = (await this.dataSource.query(
			`SELECT u.id, u.username, u.display_name, up.avatar_file
			FROM social_friend_invites invite
			JOIN users u ON u.id = invite.owner_id
			LEFT JOIN user_preferences up ON up.user_id = u.id
			WHERE invite.token = $1 AND u.disabled_at IS NULL
				AND (invite.expires_at IS NULL OR invite.expires_at > now())
				AND (invite.max_uses IS NULL OR invite.use_count < invite.max_uses)`,
			[token.toLowerCase()],
		)) as UserRow[];
		return rows[0];
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
