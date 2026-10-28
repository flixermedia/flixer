import { describe, expect, it, vi } from "vitest";
import type { DataSource } from "typeorm";
import { FriendsService } from "./friendsService.js";

const USER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

describe("FriendsService", () => {
	it("creates an outgoing request and accepts a reciprocal request", async () => {
		let statusLookups = 0;
		const query = vi.fn(async (sql: string, values: unknown[] = []) => {
			if (sql.includes("lower(u.username)")) {
				return values[0] === "sam"
					? [{ id: OTHER, username: "sam", display_name: "Sam", avatar_file: null }]
					: [{ id: USER, username: "alex", display_name: "Alex", avatar_file: null }];
			}
			if (sql.includes("WHERE u.id = $1")) {
				return [{ id: USER, username: "alex", display_name: "Alex", avatar_file: null }];
			}
			if (sql.includes("SELECT requested_by, accepted_at")) {
				statusLookups += 1;
				return statusLookups === 1 ? [] : [{ requested_by: USER, accepted_at: null }];
			}
			if (sql.includes("INSERT INTO social_friendships")) {
				return values[2] === OTHER
					? [{ requested_by: USER, accepted_at: new Date() }]
					: [{ requested_by: USER, accepted_at: null }];
			}
			return [];
		});
		const send = vi.fn(async () => ({ recipients: 1, pushed: 0 }));
		const service = new FriendsService({ query } as unknown as DataSource, { send } as never);

		expect(await service.request(USER, "sam")).toEqual({ status: "outgoing" });
		expect(query.mock.calls[3][1]).toEqual([USER, OTHER, USER]);
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
		const token = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
		const query = vi.fn(async (sql: string) => {
			if (sql.includes("lower(u.username)")) {
				return [{ id: USER, username: "alex", display_name: "Alex", avatar_file: null }];
			}
			if (sql.includes("INSERT INTO social_friend_invites")) return [{ token, expires_at: null }];
			return [];
		});
		const service = new FriendsService({ query } as unknown as DataSource, {} as never);

		expect(await service.createInvite(USER, "alex", { mode: "once" })).toEqual({ token, expiresAt: null });
		expect(query).toHaveBeenCalledTimes(2);
		expect(query.mock.calls[1][0]).toContain("social_friend_invites");
		expect(query.mock.calls[1][1]?.[2]).toBe(1);
	});

	it("creates an invite that expires after the requested duration", async () => {
		const token = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
		const query = vi.fn(async (sql: string) => {
			if (sql.includes("lower(u.username)")) {
				return [{ id: USER, username: "alex", display_name: "Alex", avatar_file: null }];
			}
			if (sql.includes("INSERT INTO social_friend_invites")) return [{ token, expires_at: new Date() }];
			return [];
		});
		const service = new FriendsService({ query } as unknown as DataSource, {} as never);

		await service.createInvite(USER, "alex", { mode: "expires", expiresInHours: 24 });
		expect(query.mock.calls[1][1]?.[2]).toBeNull();
		expect(query.mock.calls[1][1]?.[3]).toBeInstanceOf(Date);
	});

	it("creates an unlimited invite without an expiration", async () => {
		const token = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
		const query = vi.fn(async (sql: string) => {
			if (sql.includes("lower(u.username)")) {
				return [{ id: USER, username: "alex", display_name: "Alex", avatar_file: null }];
			}
			if (sql.includes("INSERT INTO social_friend_invites")) return [{ token, expires_at: null }];
			return [];
		});
		const service = new FriendsService({ query } as unknown as DataSource, {} as never);

		expect(await service.createInvite(USER, "alex", { mode: "unlimited" })).toEqual({ token, expiresAt: null });
		expect(query.mock.calls[1][1]?.[2]).toBeNull();
		expect(query.mock.calls[1][1]?.[3]).toBeNull();
	});

	it("rejects an invalid invite expiration", async () => {
		const query = vi.fn(async (sql: string) => {
			if (sql.includes("lower(u.username)")) {
				return [{ id: USER, username: "alex", display_name: "Alex", avatar_file: null }];
			}
			return [];
		});
		const service = new FriendsService({ query } as unknown as DataSource, {} as never);

		await expect(service.createInvite(USER, "alex", { mode: "expires", expiresInHours: 9000 })).rejects.toThrow(
			/expiration/,
		);
		expect(query).toHaveBeenCalledTimes(1);
	});

	it("does not create an invite for a hidden profile the viewer cannot access", async () => {
		const query = vi.fn(async (sql: string) => {
			if (sql.includes("lower(u.username)")) {
				return [{ id: OTHER, username: "sam", display_name: "Sam", avatar_file: null }];
			}
			if (sql.includes("profile_visibility")) return [{ visibility: "hidden", is_friend: false }];
			return [];
		});
		const service = new FriendsService({ query } as unknown as DataSource, {} as never);

		await expect(service.createInvite(USER, "sam")).rejects.toThrow(/not found/i);
		expect(query).toHaveBeenCalledTimes(2);
	});

	it("automatically accepts a valid friend invite", async () => {
		const token = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
		const query = vi.fn(async (sql: string) => {
			if (sql.includes("FROM social_friend_invites")) {
				return [{ owner_id: OTHER, max_uses: 1, use_count: 0, expires_at: null }];
			}
			return [];
		});
		const transaction = vi.fn(async (work: (manager: { query: typeof query }) => unknown) => work({ query }));
		const service = new FriendsService({ transaction } as unknown as DataSource, {} as never);

		expect(await service.acceptInvite(USER, token)).toEqual({ status: "friends" });
		expect(transaction).toHaveBeenCalledTimes(1);
		expect(query.mock.calls[0][0]).toContain("FOR UPDATE");
		expect(query.mock.calls[1][0]).toContain("INSERT INTO social_friendships");
		expect(query.mock.calls[2][0]).toContain("use_count = use_count + 1");
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
