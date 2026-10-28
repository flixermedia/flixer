import { Inject, Injectable } from "@tsed/di";
import { BadRequest, Forbidden, NotFound, TooManyRequests } from "@tsed/exceptions";
import { randomBytes } from "node:crypto";
import { DataSource } from "typeorm";
import { DefaultDataSource } from "../datasources/defaultDataSource.datasource.js";
import { loadSocialItems, toSocialItem, type SocialItem } from "../api/social/socialItems.js";
import { FriendsService } from "../api/social/friendsService.js";

export const PARTY_TYPES = ["movie", "episode", "video", "track"] as const;
export const MAX_PARTY_MEMBERS = 50;
/** How long a party survives without its host before it is ended. */
export const HOST_GRACE_MS = 90_000;
const MAX_POSITION_SECONDS = 24 * 60 * 60;

export interface PartyPerson {
	id: string;
	username: string;
	displayName: string;
	avatarUrl: string | null;
}

export interface PartySnapshot {
	id: string;
	kind: "video" | "music";
	visibility: "public" | "friends" | "private";
	host: PartyPerson;
	item: SocialItem;
	playing: boolean;
	/** Playback position in seconds as of `at`. */
	position: number;
	/** Server time (ms since epoch) at which `position` was recorded. */
	at: number;
	members: PartyPerson[];
}

export interface PartySummary {
	id: string;
	kind: "video" | "music";
	title: string;
	memberCount: number;
}

export interface PartyChatMessage {
	id: string;
	from: PartyPerson;
	text: string;
	at: number;
}

export const MAX_CHAT_LENGTH = 500;
const CHAT_HISTORY = 50;
const CHAT_BURST = 5;
const CHAT_WINDOW_MS = 5_000;

export type PartyMessage =
	| { type: "state"; party: PartySnapshot; serverTime: number }
	| { type: "chat"; message: PartyChatMessage }
	| { type: "chat-history"; messages: PartyChatMessage[] }
	| { type: "ended"; reason: "host-ended" | "host-left" };

export interface PartyControl {
	itemId?: string;
	playing: boolean;
	position: number;
}

interface Connection {
	userId: string;
	send: (message: PartyMessage) => void;
}

interface Party {
	id: string;
	kind: "video" | "music";
	visibility: "public" | "friends" | "private";
	host: PartyPerson;
	item: SocialItem;
	playing: boolean;
	position: number;
	at: number;
	people: Map<string, PartyPerson>;
	connections: Set<Connection>;
	chat: PartyChatMessage[];
	chatTimes: Map<string, number[]>;
	hostTimer?: NodeJS.Timeout;
}

/** Keeps watch and listen parties in memory: the host drives playback and everybody else follows. */
@Injectable()
export class PartiesService {
	private readonly parties = new Map<string, Party>();
	private readonly byHost = new Map<string, string>();

	constructor(
		@Inject(DefaultDataSource) private readonly dataSource: DataSource,
		private readonly friends: FriendsService,
	) {}

	async create(
		host: PartyPerson,
		itemId: string,
		visibility: "public" | "friends" | "private" = "public",
	): Promise<PartySnapshot> {
		const item = await this.loadItem(itemId);
		const existing = this.byHost.get(host.id);
		if (existing) {
			this.end(existing, "host-ended");
		}
		const party: Party = {
			id: randomBytes(6).toString("base64url"),
			kind: item.type === "track" ? "music" : "video",
			visibility,
			host,
			item,
			playing: false,
			position: 0,
			at: Date.now(),
			people: new Map([[host.id, host]]),
			connections: new Set(),
			chat: [],
			chatTimes: new Map(),
		};
		this.parties.set(party.id, party);
		this.byHost.set(host.id, party.id);
		this.armHostTimer(party);
		return this.snapshot(party);
	}

	async get(id: string, viewerId: string): Promise<PartySnapshot> {
		const party = this.require(id);
		await this.requireAccess(party, viewerId, true);
		return this.snapshot(party);
	}

	/** The party this person is currently hosting, for their profile. */
	hostedBy(userId: string): PartySummary | null {
		const party = this.parties.get(this.byHost.get(userId) ?? "");
		return party && party.visibility === "public"
			? { id: party.id, kind: party.kind, title: party.item.title, memberCount: party.people.size }
			: null;
	}

	async hostedByUsername(username: string, viewerId: string): Promise<PartySummary | null> {
		for (const party of this.parties.values()) {
			if (party.host.username.toLowerCase() === username.toLowerCase()) {
				if (party.visibility === "private") return null;
				if (
					party.visibility === "friends" &&
					viewerId !== party.host.id &&
					!(await this.friends.areFriends(viewerId, party.host.id))
				)
					return null;
				return { id: party.id, kind: party.kind, title: party.item.title, memberCount: party.people.size };
			}
		}
		return null;
	}

	/** Adds a live connection and returns a function that removes it. Throws NotFound when the party is over. */
	async join(
		id: string,
		person: PartyPerson,
		send: (message: PartyMessage) => void,
	): Promise<{ snapshot: PartySnapshot; leave: () => void }> {
		const party = this.require(id);
		await this.requireAccess(party, person.id, true);
		if (!party.people.has(person.id) && party.people.size >= MAX_PARTY_MEMBERS) {
			throw new BadRequest("This party is full.");
		}
		const connection: Connection = { userId: person.id, send };
		party.connections.add(connection);
		party.people.set(person.id, person);
		if (person.id === party.host.id) {
			clearTimeout(party.hostTimer);
		}
		this.broadcast(party);
		return {
			snapshot: this.snapshot(party),
			leave: () => this.leave(party, connection),
		};
	}

	async control(id: string, userId: string, control: PartyControl): Promise<void> {
		const party = this.require(id);
		if (party.host.id !== userId) {
			throw new Forbidden("Only the host controls playback.");
		}
		if (control.itemId && control.itemId !== party.item.id) {
			const item = await this.loadItem(control.itemId);
			if ((item.type === "track") !== (party.kind === "music")) {
				throw new BadRequest("A party cannot switch between video and music.");
			}
			party.item = item;
		}
		party.playing = control.playing === true;
		party.position = Number.isFinite(control.position)
			? Math.min(Math.max(0, control.position), MAX_POSITION_SECONDS)
			: 0;
		party.at = Date.now();
		this.broadcast(party);
	}

	chatHistory(id: string): PartyChatMessage[] {
		return [...this.require(id).chat];
	}

	/** Any member can chat; messages are relayed to everyone in the party and the latest few are kept for people who join later. */
	chat(id: string, person: PartyPerson, rawText: string): void {
		const party = this.require(id);
		if (!party.people.has(person.id)) {
			throw new Forbidden("Join the party to chat.");
		}
		const text = rawText.replace(/\s+/g, " ").trim().slice(0, MAX_CHAT_LENGTH);
		if (text === "") {
			return;
		}
		const now = Date.now();
		const recent = (party.chatTimes.get(person.id) ?? []).filter((time) => now - time < CHAT_WINDOW_MS);
		if (recent.length >= CHAT_BURST) {
			throw new TooManyRequests("You're sending messages too quickly.");
		}
		recent.push(now);
		party.chatTimes.set(person.id, recent);
		const message: PartyChatMessage = { id: randomBytes(6).toString("base64url"), from: person, text, at: now };
		party.chat.push(message);
		if (party.chat.length > CHAT_HISTORY) {
			party.chat.shift();
		}
		for (const connection of party.connections) {
			connection.send({ type: "chat", message });
		}
	}

	endBy(id: string, userId: string): void {
		const party = this.require(id);
		if (party.host.id !== userId) {
			throw new Forbidden("Only the host can end the party.");
		}
		this.end(id, "host-ended");
	}

	end(id: string, reason: "host-ended" | "host-left"): void {
		const party = this.parties.get(id);
		if (!party) {
			return;
		}
		clearTimeout(party.hostTimer);
		this.parties.delete(id);
		if (this.byHost.get(party.host.id) === id) {
			this.byHost.delete(party.host.id);
		}
		for (const connection of party.connections) {
			connection.send({ type: "ended", reason });
		}
		party.connections.clear();
	}

	private leave(party: Party, connection: Connection): void {
		if (!party.connections.delete(connection)) {
			return;
		}
		if ([...party.connections].some((other) => other.userId === connection.userId)) {
			return;
		}
		if (connection.userId === party.host.id) {
			this.armHostTimer(party);
			return;
		}
		party.people.delete(connection.userId);
		this.broadcast(party);
	}

	private armHostTimer(party: Party): void {
		clearTimeout(party.hostTimer);
		party.hostTimer = setTimeout(() => this.end(party.id, "host-left"), HOST_GRACE_MS);
		party.hostTimer.unref();
	}

	private broadcast(party: Party): void {
		const message: PartyMessage = { type: "state", party: this.snapshot(party), serverTime: Date.now() };
		for (const connection of party.connections) {
			connection.send(message);
		}
	}

	private snapshot(party: Party): PartySnapshot {
		return {
			id: party.id,
			kind: party.kind,
			visibility: party.visibility,
			host: party.host,
			item: party.item,
			playing: party.playing,
			position: party.position,
			at: party.at,
			members: [...party.people.values()],
		};
	}

	private require(id: string): Party {
		const party = this.parties.get(id);
		if (!party) {
			throw new NotFound("This party has ended.");
		}
		return party;
	}

	private async requireAccess(party: Party, viewerId: string, allowPrivateLink: boolean): Promise<void> {
		if (
			party.host.id === viewerId ||
			party.visibility === "public" ||
			(allowPrivateLink && party.visibility === "private")
		)
			return;
		if (party.visibility === "friends" && (await this.friends.areFriends(viewerId, party.host.id))) return;
		throw new NotFound("This party is not available.");
	}

	private async loadItem(itemId: string): Promise<SocialItem> {
		const [loaded] = await loadSocialItems(this.dataSource, [itemId]);
		if (!loaded || !(PARTY_TYPES as readonly string[]).includes(loaded.type)) {
			throw new BadRequest("This item cannot be shared in a party.");
		}
		return toSocialItem(loaded);
	}
}
