import { afterEach, describe, expect, it, vi } from "vitest";
import type { DataSource } from "typeorm";

vi.mock("../api/social/socialItems.js", () => ({
	loadSocialItems: vi.fn(async (_source: unknown, ids: string[]) =>
		ids.map((id) => ({ id, type: id.startsWith("t") ? "track" : id.startsWith("s") ? "series" : "movie", title: `Item ${id}`, raw: {}, album: null })),
	),
	toSocialItem: ({ raw: _raw, album: _album, ...card }: Record<string, unknown>) => card,
}));

import { HOST_GRACE_MS, PartiesService, type PartyMessage, type PartyPerson } from "./partiesService.js";

const person = (id: string): PartyPerson => ({ id, username: id, displayName: id.toUpperCase(), avatarUrl: null });

describe("PartiesService", () => {
	afterEach(() => vi.useRealTimers());

	it("creates a party for movies and songs only", async () => {
		const service = new PartiesService({} as DataSource);
		const movie = await service.create(person("host"), "m1");
		expect(movie.kind).toBe("video");
		expect(movie.members.map((m) => m.id)).toEqual(["host"]);
		await expect(service.create(person("host"), "s1")).rejects.toThrow(/cannot be shared/);
		expect((await service.create(person("host2"), "t1")).kind).toBe("music");
	});

	it("shares host playback with every joined connection and lists members", async () => {
		const service = new PartiesService({} as DataSource);
		const { id } = await service.create(person("host"), "m1");
		const hostMessages: PartyMessage[] = [];
		const guestMessages: PartyMessage[] = [];
		service.join(id, person("host"), (m) => hostMessages.push(m));
		const guest = service.join(id, person("guest"), (m) => guestMessages.push(m));
		expect(guest.snapshot.members.map((m) => m.id)).toEqual(["host", "guest"]);

		await service.control(id, "host", { playing: true, position: 42 });
		const last = guestMessages.at(-1);
		expect(last).toMatchObject({ type: "state", party: { playing: true, position: 42 } });

		guest.leave();
		expect(service.get(id).members.map((m) => m.id)).toEqual(["host"]);
	});

	it("only lets the host control or end the party", async () => {
		const service = new PartiesService({} as DataSource);
		const { id } = await service.create(person("host"), "m1");
		await expect(service.control(id, "guest", { playing: true, position: 1 })).rejects.toThrow(/Only the host/);
		expect(() => service.endBy(id, "guest")).toThrow(/Only the host/);
	});

	it("keeps the party kind when the host changes item", async () => {
		const service = new PartiesService({} as DataSource);
		const { id } = await service.create(person("host"), "m1");
		await service.control(id, "host", { itemId: "m2", playing: true, position: 0 });
		expect(service.get(id).item.id).toBe("m2");
		await expect(service.control(id, "host", { itemId: "t1", playing: true, position: 0 })).rejects.toThrow(/switch/);
	});

	it("ends the party for everyone when the host ends it and replaces an older party", async () => {
		const service = new PartiesService({} as DataSource);
		const first = await service.create(person("host"), "m1");
		const messages: PartyMessage[] = [];
		service.join(first.id, person("guest"), (m) => messages.push(m));
		await service.create(person("host"), "m2");
		expect(messages.at(-1)).toEqual({ type: "ended", reason: "host-ended" });
		expect(() => service.get(first.id)).toThrow(/ended/);
	});

	it("ends the party when the host stays away", async () => {
		vi.useFakeTimers();
		const service = new PartiesService({} as DataSource);
		const { id } = await service.create(person("host"), "m1");
		const host = service.join(id, person("host"), () => undefined);
		host.leave();
		vi.advanceTimersByTime(HOST_GRACE_MS + 1);
		expect(() => service.get(id)).toThrow(/ended/);
		expect(service.hostedBy("host")).toBeNull();
	});

	it("reports the hosted party for a profile", async () => {
		const service = new PartiesService({} as DataSource);
		const { id } = await service.create(person("Host"), "m1");
		expect(service.hostedByUsername("host")).toMatchObject({ id, kind: "video", title: "Item m1", memberCount: 1 });
		expect(service.hostedByUsername("nobody")).toBeNull();
	});
});
