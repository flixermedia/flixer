import { describe, expect, it, vi } from "vitest";
import type { DataSource } from "typeorm";
import { FriendsController } from "./friendsController.js";
import { SocialFriendInvite, SocialFriendship } from "../../entities/social.entity.js";
import { FriendsService } from "./friendsService.js";

const USER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

/** A FriendsService whose user lookups come from `user(username)` and whose invite repository insert is observable. */
function inviteService(user: (username: unknown) => unknown = () => ({ id: USER, username: "alex", display_name: "Alex", avatar_file: null })) {

	const query = vi.fn(async (sql: string, values: unknown[] = []) => (sql.includes("lower(u.username)") ? [user(values[0])] : []));
	const insert = vi.fn(async () => ({}));
	const getRepository = vi.fn((entity: unknown) => {
		expect(entity).toBe(SocialFriendInvite);
		return { insert };
	});
	return { query, insert, service: new FriendsService({ query, getRepository } as unknown as DataSource, {} as never) };

}

describe("FriendsService", () => {
	it("creates an outgoing request and accepts a reciprocal request", async () => {
		let statusLookups = 0;
		const query = vi.fn(async (sql: string, values: unknown[] = []) => {
			if (sql.includes("lower(u.username)")) {
				return values[0] === "sam" ? [{ id: OTHER, username: "sam", display_name: "Sam", avatar_file: null }] : [{ id: USER, username: "alex", display_name: "Alex", avatar_file: null }];
			}
			if (sql.includes("WHERE u.id = $1")) {
				return [{ id: USER, username: "alex", display_name: "Alex", avatar_file: null }];
			}
			if (sql.includes("INSERT INTO social_friendships")) {
				return values[2] === OTHER ? [{ requested_by: USER, accepted_at: new Date() }] : [{ requested_by: USER, accepted_at: null }];
			}
			return [];
		});
		const findOne = vi.fn(async () => {
			statusLookups += 1;
			return statusLookups === 1 ? null : { requestedBy: USER, acceptedAt: null };
		});
		const getRepository = vi.fn((entity: unknown) => {
			expect(entity).toBe(SocialFriendship);
			return { findOne };
		});
		const send = vi.fn(async () => ({ recipients: 1, pushed: 0 }));
		const service = new FriendsService({ query, getRepository } as unknown as DataSource, { send } as never);

		expect(await service.request(USER, "sam")).toEqual({ status: "outgoing" });
		expect(query.mock.calls[2][1]).toEqual([USER, OTHER, USER]);
		expect(send).toHaveBeenCalledWith(
			{
				kind: "friend_request",
				title: "Friend request",
				body: "Alex sent you a friend request.",
				url: "/u/alex",
			},
			[OTHER],
		);

		expect(await service.request(OTHER, "alex")).toEqual({ status: "friends" });
		expect(send).toHaveBeenCalledTimes(1);
	});

	it("does not allow a user to send a request to themselves", async () => {
		const query = vi.fn(async () => [{ id: USER, username: "alex", display_name: null, avatar_file: null }]);
		const service = new FriendsService({ query } as unknown as DataSource, {} as never);
		await expect(service.request(USER, "alex")).rejects.toThrow(/yourself/);
		expect(query).toHaveBeenCalledTimes(1);
	});

	it("creates a one-time invite token for the profile owner", async () => {
		const { service, query, insert } = inviteService();

		const result = await service.createInvite(USER, "alex", { mode: "once" });
		expect(query).toHaveBeenCalledTimes(1);
		expect(insert).toHaveBeenCalledWith({ token: result.token, ownerId: USER, maxUses: 1, expiresAt: null });
		expect(result).toEqual({ token: expect.stringMatching(/^[\da-f-]{36}$/), expiresAt: null });
	});

	it("creates an invite that expires after the requested duration", async () => {
		const { service, insert } = inviteService();

		const result = await service.createInvite(USER, "alex", { mode: "expires", expiresInHours: 24 });
		expect(insert).toHaveBeenCalledWith({ token: result.token, ownerId: USER, maxUses: null, expiresAt: expect.any(Date) });
		expect(result.expiresAt).toBeInstanceOf(Date);
	});

	it("creates an unlimited invite without an expiration", async () => {
		const { service, insert } = inviteService();

		const result = await service.createInvite(USER, "alex", { mode: "unlimited" });
		expect(result.expiresAt).toBeNull();
		expect(insert).toHaveBeenCalledWith({ token: result.token, ownerId: USER, maxUses: null, expiresAt: null });
	});

	it("rejects an invalid invite expiration", async () => {
		const query = vi.fn(async (sql: string) => {
			if (sql.includes("lower(u.username)")) {
				return [{ id: USER, username: "alex", display_name: "Alex", avatar_file: null }];
			}
			return [];
		});
		const service = new FriendsService({ query } as unknown as DataSource, {} as never);

		await expect(service.createInvite(USER, "alex", { mode: "expires", expiresInHours: 9000 })).rejects.toThrow(/expiration/);
		expect(query).toHaveBeenCalledTimes(1);
	});

	it.each([
		{ visibility: "public", is_friend: false },
		{ visibility: "friends", is_friend: true },
		{ visibility: "hidden", is_friend: false },
	])("does not create an invite for another user with $visibility visibility", async ({ visibility, is_friend }) => {
		const query = vi.fn(async (sql: string) => {
			if (sql.includes("lower(u.username)")) {
				return [{ id: OTHER, username: "sam", display_name: "Sam", avatar_file: null }];
			}
			if (sql.includes("profile_visibility")) return [{ visibility, is_friend }];
			if (sql.includes("INSERT INTO social_friend_invites")) return [{ token: "forged", expires_at: null }];
			return [];
		});
		const service = new FriendsService({ query } as unknown as DataSource, {} as never);

		await expect(service.createInvite(USER, "sam", { mode: "once" })).rejects.toThrow(/not found/i);
		expect(query).toHaveBeenCalledTimes(1);
	});

	it("binds the invite owner to the authenticated controller user", async () => {
		const { service, query, insert } = inviteService((value) => (value === "sam" ? { id: OTHER, username: "sam", display_name: "Sam", avatar_file: null } : { id: USER, username: "alex", display_name: "Alex", avatar_file: null }));
		const auth = { getAuthenticatedUser: vi.fn(async () => ({ id: USER })) };
		const controller = new FriendsController(auth as never, service);

		await expect(controller.createInvite("sam", { mode: "once" }, "Bearer attacker")).rejects.toThrow(/not found/i);
		expect(query).toHaveBeenCalledTimes(1);
		expect(insert).not.toHaveBeenCalled();
		expect(await controller.createInvite("alex", { mode: "once" }, "Bearer attacker")).toEqual({ token: expect.any(String), expiresAt: null });
		expect(auth.getAuthenticatedUser).toHaveBeenCalledWith("Bearer attacker");
		expect(insert).toHaveBeenCalledWith(expect.objectContaining({ ownerId: USER }));
	});

	it("automatically accepts a valid friend invite", async () => {
		const token = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
		const query = vi.fn(async (sql: string) => {
			if (sql.includes("FROM social_friend_invites")) {
				return [{ owner_id: OTHER, max_uses: 1, use_count: 0, expires_at: null }];
			}
			return [];
		});
		const increment = vi.fn(async () => ({}));
		const transaction = vi.fn(async (work: (manager: { query: typeof query; increment: typeof increment }) => unknown) => work({ query, increment }));
		const service = new FriendsService({ transaction } as unknown as DataSource, {} as never);

		expect(await service.acceptInvite(USER, token)).toEqual({ status: "friends" });
		expect(transaction).toHaveBeenCalledTimes(1);
		expect(query.mock.calls[0][0]).toContain("FOR UPDATE");
		expect(query.mock.calls[1][0]).toContain("INSERT INTO social_friendships");
		expect(increment).toHaveBeenCalledWith(SocialFriendInvite, { token }, "useCount", 1);
	});

	it("rejects a friend invite that has already reached its use limit", async () => {
		const token = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
		const query = vi.fn(async () => []);
		const transaction = vi.fn(async (work: (manager: { query: typeof query }) => unknown) => work({ query }));
		const service = new FriendsService({ transaction } as unknown as DataSource, {} as never);

		await expect(service.acceptInvite(USER, token)).rejects.toThrow(/not found/i);
		expect(query).toHaveBeenCalledTimes(1);
	});
});
