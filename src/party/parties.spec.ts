import { afterEach, describe, expect, it, vi } from "vitest";
import type { DataSource } from "typeorm";
import type { FriendsService } from "../api/social/friendsService.js";
import type { PartyRedisService } from "./partyRedisService.js";

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

import {
	HOST_GRACE_MS,
	PartiesService,
	type PartyMessage,
	type PartyPerson,
	type PartySnapshot,
} from "./partiesService.js";

const person = (id: string): PartyPerson => ({ id, username: id, displayName: id.toUpperCase(), avatarUrl: null });

class FakeRedis {
	private readonly values = new Map<string, string>();
	private readonly sets = new Map<string, Set<string>>();
	private readonly people = new Map<string, Map<string, string>>();
	private readonly presence = new Map<string, Set<string>>();
	private readonly lists = new Map<string, string[]>();
	private readonly rates = new Map<string, number>();
	private onMessage?: (message: string) => void;

	get = async (key: string) => this.values.get(key) ?? null;

	set = async (key: string, value: string, options?: { NX?: boolean }) => {
		if (options?.NX && this.values.has(key)) return null;
		this.values.set(key, value);
		return "OK";
	};

	multi() {
		const operations: (() => void)[] = [];
		const transaction = {
			set: (key: string, value: string) => {
				operations.push(() => this.values.set(key, value));
				return transaction;
			},
			sAdd: (key: string, value: string) => {
				operations.push(() => {
					const set = this.sets.get(key) ?? new Set<string>();
					set.add(value);
					this.sets.set(key, set);
				});
				return transaction;
			},
			exec: async () => {
				operations.forEach((operation) => operation());
				return [];
			},
		};
		return transaction;
	}

	sMembers = async (key: string) => [...(this.sets.get(key) ?? [])];

	lRange = async (key: string) => this.lists.get(key) ?? [];

	sendCommand = async () => ["1000", "0"];

	subscribe = (callback: (message: string) => void) => {
		this.onMessage = callback;
	};

	async eval(script: string, options: { keys: string[]; arguments: string[] }): Promise<string> {
		if (script.includes("local command = cjson.decode(ARGV[2])")) return this.control(options);
		if (script.includes("local isMember = false")) return this.chat(options);
		if (script.includes("local action = ARGV[1]")) return this.updatePresence(options);
		if (script.includes("message={type='ended'")) return this.end(options);
		throw new Error("Unrecognized party Lua script.");
	}

	private control({ keys, arguments: args }: { keys: string[]; arguments: string[] }): string {
		const raw = this.values.get(keys[0]);
		if (!raw) return JSON.stringify({ error: "missing" });
		const party = JSON.parse(raw) as PartySnapshot & { lastCommandId?: string };
		if (party.host.id !== args[0]) return JSON.stringify({ error: "forbidden" });
		const command = JSON.parse(args[1]) as {
			action: string;
			commandId: string;
			itemId?: string;
			position?: number;
		};
		if (party.lastCommandId === command.commandId) return JSON.stringify({ party, serverTime: 1_000 });
		const item = args[3] ? (JSON.parse(args[3]) as PartySnapshot["item"]) : undefined;
		let position = party.position + (party.playing ? Math.max(0, 1_000 - party.at) / 1_000 : 0);
		if (item && item.id !== party.item.id) {
			party.item = item;
			position = 0;
		}
		if (command.action === "play") party.playing = true;
		else if (command.action === "pause") party.playing = false;
		else if (command.action === "seek") position = command.position ?? 0;
		party.position = position;
		party.at = 1_300;
		party.version++;
		party.lastCommandId = command.commandId;
		this.values.set(keys[0], JSON.stringify(party));
		this.publish(party.id, { type: "state", party, serverTime: 1_000 });
		return JSON.stringify({ party, serverTime: 1_000 });
	}

	private updatePresence({ keys, arguments: args }: { keys: string[]; arguments: string[] }): string {
		const raw = this.values.get(keys[0]);
		if (!raw) return JSON.stringify({ error: "missing" });
		const party = JSON.parse(raw) as PartySnapshot;
		const people = this.people.get(keys[2]) ?? new Map<string, string>();
		const connections = this.presence.get(keys[1]) ?? new Set<string>();
		const [action, connectionId, , , maxMembers, personJson, requestedAction] = args;
		if (action === "join") {
			const memberIds = new Set([...people.values()].map((value) => (JSON.parse(value) as PartyPerson).id));
			const joiningPersonId = (JSON.parse(personJson) as PartyPerson).id;
			if (!memberIds.has(joiningPersonId) && memberIds.size >= Number(maxMembers)) {
				return JSON.stringify({ error: "full" });
			}
			connections.add(connectionId);
			people.set(connectionId, personJson);
		} else if (action === "leave") {
			connections.delete(connectionId);
			people.delete(connectionId);
		}
		this.people.set(keys[2], people);
		this.presence.set(keys[1], connections);
		const seen = new Set<string>();
		party.members = [...connections].flatMap((id) => {
			const rawPerson = people.get(id);
			if (!rawPerson) return [];
			const member = JSON.parse(rawPerson) as PartyPerson;
			if (seen.has(member.id)) return [];
			seen.add(member.id);
			return [member];
		});
		this.values.set(keys[0], JSON.stringify(party));
		if (requestedAction !== "renew") this.publish(party.id, { type: "state", party, serverTime: 1_000 });
		return JSON.stringify({ party, serverTime: 1_000 });
	}

	private chat({ keys, arguments: args }: { keys: string[]; arguments: string[] }): string {
		if (!this.values.has(keys[0])) return JSON.stringify({ error: "missing" });
		const isMember = [...(this.people.get(keys[1]) ?? new Map()).values()].some(
			(value) => (JSON.parse(value) as PartyPerson).id === args[0],
		);
		if (!isMember) return JSON.stringify({ error: "not-member" });
		const count = (this.rates.get(keys[2]) ?? 0) + 1;
		this.rates.set(keys[2], count);
		if (count > 5) return JSON.stringify({ error: "rate-limited" });
		const message = JSON.parse(args[1]) as { at: number; id: string; from: PartyPerson; text: string };
		message.at = 1_000;
		const list = this.lists.get(keys[3]) ?? [];
		list.unshift(JSON.stringify(message));
		this.lists.set(keys[3], list.slice(0, 50));
		this.publish(args[2], { type: "chat", message });
		return JSON.stringify(message);
	}

	private end({ keys, arguments: args }: { keys: string[]; arguments: string[] }): string {
		const raw = this.values.get(keys[0]);
		if (!raw) return JSON.stringify({ error: "missing" });
		const party = JSON.parse(raw) as PartySnapshot;
		if (args[0] && party.host.id !== args[0]) return JSON.stringify({ error: "forbidden" });
		this.publish(party.id, { type: "ended", reason: args[1] as "host-ended" | "host-left" });
		this.values.delete(keys[0]);
		this.values.delete(keys[1]);
		this.values.delete(keys[2]);
		this.sets.get(keys[3])?.delete(party.id);
		this.people.delete(keys[5]);
		this.presence.delete(keys[4]);
		return JSON.stringify({ party });
	}

	private publish(partyId: string, message: PartyMessage) {
		this.onMessage?.(JSON.stringify({ partyId, message }));
	}
}

const activeServices: PartiesService[] = [];

async function createService(friends: FriendsService = { areFriends: async () => false } as FriendsService) {
	const redis = new FakeRedis();
	const partyRedis = {
		get commands() {
			return redis;
		},
		start: async (callback: (message: string) => void) => redis.subscribe(callback),
		stop: async () => undefined,
	} as unknown as PartyRedisService;
	const service = new PartiesService({} as DataSource, friends, partyRedis);
	await service.$onInit();
	activeServices.push(service);
	return service;
}

describe("PartiesService", () => {
	afterEach(async () => {
		vi.useRealTimers();
		await Promise.all(activeServices.splice(0).map((service) => service.$onDestroy()));
	});

	it("creates video and music parties and rejects unsupported media", async () => {
		const service = await createService();
		const movie = await service.create(person("host"), "m1");
		expect(movie.kind).toBe("video");
		expect(movie.members.map((member) => member.id)).toEqual(["host"]);
		await expect(service.create(person("host"), "s1")).rejects.toThrow(/cannot be shared/);
		expect((await service.create(person("host2"), "t1")).kind).toBe("music");
	});

	it("stores versioned host commands and fans out canonical state", async () => {
		const service = await createService();
		const { id } = await service.create(person("host"), "m1");
		const messages: PartyMessage[] = [];
		await service.join(id, person("guest"), (message) => messages.push(message));
		await service.control(id, "host", { action: "seek", commandId: "seek-1", position: 42 });
		expect(messages.at(-1)).toMatchObject({
			type: "state",
			party: { position: 42, version: 1, playbackRate: 1 },
		});
	});

	it("only lets the host control or end a party and validates commands", async () => {
		const service = await createService();
		const { id } = await service.create(person("host"), "m1");
		await expect(service.control(id, "guest", { action: "pause", commandId: "pause-1" })).rejects.toThrow(
			/Only the host/,
		);
		await expect(
			service.control(id, "host", { action: "change-item", commandId: "change-1", itemId: "" }),
		).rejects.toThrow(/item is required/);
		await expect(service.endBy(id, "guest")).rejects.toThrow(/Only the host/);
	});

	it("keeps party kind when playback changes item and ends replaced parties", async () => {
		const service = await createService();
		const first = await service.create(person("host"), "m1");
		const messages: PartyMessage[] = [];
		await service.join(first.id, person("guest"), (message) => messages.push(message));
		await service.control(first.id, "host", { action: "change-item", commandId: "change-1", itemId: "m2" });
		expect((await service.get(first.id, "host")).item.id).toBe("m2");
		await expect(
			service.control(first.id, "host", { action: "change-item", commandId: "change-2", itemId: "t1" }),
		).rejects.toThrow(/switch/);
		await service.create(person("host"), "m3");
		expect(messages.at(-1)).toEqual({ type: "ended", reason: "host-ended" });
	});

	it("ends a party when the host does not reconnect before the grace period", async () => {
		vi.useFakeTimers();
		const service = await createService();
		const { id } = await service.create(person("host"), "m1");
		const host = await service.join(id, person("host"), () => undefined);
		await host.leave();
		await vi.advanceTimersByTimeAsync(HOST_GRACE_MS + 1);
		await expect(service.get(id, "host")).rejects.toThrow(/ended/);
	});

	it("limits chat to current members and returns recent history", async () => {
		const service = await createService();
		const { id } = await service.create(person("host"), "m1");
		const messages: PartyMessage[] = [];
		await service.join(id, person("guest"), (message) => messages.push(message));
		await service.chat(id, person("guest"), "  hello \n there ");
		expect(messages.at(-1)).toMatchObject({ type: "chat", message: { text: "hello there" } });
		expect(await service.chatHistory(id)).toHaveLength(1);
		await expect(service.chat(id, person("stranger"), "hi")).rejects.toThrow(/Join the party/);
	});
});
