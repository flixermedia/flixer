import { afterEach, describe, expect, it, vi } from "vitest";
import type { DataSource } from "typeorm";
import type { FriendsService } from "../api/social/friendsService.js";

vi.mock("../api/social/socialItems.js", () => ({
	loadSocialItems: vi.fn(async (_source: unknown, ids: string[]) =>
		ids.map((id) => ({
			id,
			type: id.startsWith("t") ? "track" : id.startsWith("s") ? "series" : "movie",
			title: `Item ${id}`,
			raw: {},
			album: null,
		})),
	),
	toSocialItem: ({ raw: _raw, album: _album, ...card }: Record<string, unknown>) => card,
}));

import { HOST_GRACE_MS, PartiesService, type PartyMessage, type PartyPerson } from "./partiesService.js";

const person = (id: string): PartyPerson => ({ id, username: id, displayName: id.toUpperCase(), avatarUrl: null });
const createService = (
	source: unknown = {},
	friends: FriendsService = { areFriends: async () => false } as FriendsService,
) => new PartiesService(source as DataSource, friends);

describe("PartiesService", () => {
	afterEach(() => vi.useRealTimers());

	it("creates a party for movies and songs only", async () => {
		const service = createService();
		const movie = await service.create(person("host"), "m1");
		expect(movie.kind).toBe("video");
		expect(movie.members.map((m) => m.id)).toEqual(["host"]);
		await expect(service.create(person("host"), "s1")).rejects.toThrow(/cannot be shared/);
		expect((await service.create(person("host2"), "t1")).kind).toBe("music");
	});

	it("shares host playback with every joined connection and lists members", async () => {
		const service = createService();
		const { id } = await service.create(person("host"), "m1");
		const hostMessages: PartyMessage[] = [];
		const guestMessages: PartyMessage[] = [];
		await service.join(id, person("host"), (m) => hostMessages.push(m));
		const guest = await service.join(id, person("guest"), (m) => guestMessages.push(m));
		expect(guest.snapshot.members.map((m) => m.id)).toEqual(["host", "guest"]);

		await service.control(id, "host", { playing: true, position: 42 });
		const last = guestMessages.at(-1);
		expect(last).toMatchObject({ type: "state", party: { playing: true, position: 42 } });

		guest.leave();
		expect((await service.get(id, "host")).members.map((m) => m.id)).toEqual(["host"]);
	});

	it("only lets the host control or end the party", async () => {
		const service = createService();
		const { id } = await service.create(person("host"), "m1");
		await expect(service.control(id, "guest", { playing: true, position: 1 })).rejects.toThrow(/Only the host/);
		expect(() => service.endBy(id, "guest")).toThrow(/Only the host/);
	});

	it("keeps the party kind when the host changes item", async () => {
		const service = createService();
		const { id } = await service.create(person("host"), "m1");
		await service.control(id, "host", { itemId: "m2", playing: true, position: 0 });
		expect((await service.get(id, "host")).item.id).toBe("m2");
		await expect(service.control(id, "host", { itemId: "t1", playing: true, position: 0 })).rejects.toThrow(
			/switch/,
		);
	});

	it("ends the party for everyone when the host ends it and replaces an older party", async () => {
		const service = createService();
		const first = await service.create(person("host"), "m1");
		const messages: PartyMessage[] = [];
		await service.join(first.id, person("guest"), (m) => messages.push(m));
		await service.create(person("host"), "m2");
		expect(messages.at(-1)).toEqual({ type: "ended", reason: "host-ended" });
		await expect(service.get(first.id, "host")).rejects.toThrow(/ended/);
	});

	it("ends the party when the host stays away", async () => {
		vi.useFakeTimers();
		const service = createService();
		const { id } = await service.create(person("host"), "m1");
		const host = await service.join(id, person("host"), () => undefined);
		host.leave();
		vi.advanceTimersByTime(HOST_GRACE_MS + 1);
		await expect(service.get(id, "host")).rejects.toThrow(/ended/);
		expect(service.hostedBy("host")).toBeNull();
	});

	it("reports the hosted party for a profile", async () => {
		const service = createService();
		const { id } = await service.create(person("Host"), "m1");
		expect(await service.hostedByUsername("host", "viewer")).toMatchObject({
			id,
			kind: "video",
			title: "Item m1",
			memberCount: 1,
		});
		expect(await service.hostedByUsername("nobody", "viewer")).toBeNull();
	});

	it("keeps private parties off profiles but lets invite-link holders load them", async () => {
		const service = createService();
		const { id, visibility } = await service.create(person("host"), "m1", "private");
		expect(visibility).toBe("private");
		expect(await service.hostedByUsername("host", "viewer")).toBeNull();
		expect((await service.get(id, "viewer")).id).toBe(id);
		const guest = await service.join(id, person("viewer"), () => undefined);
		expect(guest.snapshot.visibility).toBe("private");
	});

	it("restricts friends-only parties to accepted friends", async () => {
		const friends = {
			areFriends: vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true),
		} as unknown as FriendsService;
		const service = createService({}, friends);
		const { id } = await service.create(person("host"), "m1", "friends");
		await expect(service.join(id, person("stranger"), () => undefined)).rejects.toThrow(/not available/);
		expect((await service.join(id, person("friend"), () => undefined)).snapshot.visibility).toBe("friends");
	});

	it("relays chat to everyone, keeps history, trims text and rate limits", async () => {
		const service = createService();
		const { id } = await service.create(person("host"), "m1");
		const hostMessages: PartyMessage[] = [];
		const guestMessages: PartyMessage[] = [];
		await service.join(id, person("host"), (m) => hostMessages.push(m));
		await service.join(id, person("guest"), (m) => guestMessages.push(m));

		service.chat(id, person("guest"), "  hello \n  there ");
		expect(hostMessages.at(-1)).toMatchObject({
			type: "chat",
			message: { text: "hello there", from: { id: "guest" } },
		});
		expect(guestMessages.at(-1)).toMatchObject({ type: "chat" });
		service.chat(id, person("guest"), "   ");
		expect(service.chatHistory(id)).toHaveLength(1);

		expect(() => service.chat(id, person("stranger"), "hi")).toThrow(/Join the party/);
		for (let i = 0; i < 4; i++) service.chat(id, person("guest"), `m${i}`);
		expect(() => service.chat(id, person("guest"), "too many")).toThrow(/too quickly/);
	});
});
