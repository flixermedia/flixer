import { Inject, Injectable, logger } from "@tsed/di";
import { BadRequest, Forbidden, NotFound, TooManyRequests } from "@tsed/exceptions";
import { randomBytes, randomUUID } from "node:crypto";
import { DataSource } from "typeorm";
import { DefaultDataSource } from "../datasources/defaultDataSource.datasource.js";
import { loadSocialItems, toSocialItem, type SocialItem } from "../api/social/socialItems.js";
import { FriendsService } from "../api/social/friendsService.js";
import { PARTY_EVENTS_CHANNEL, PartyRedisService } from "./partyRedisService.js";

export const PARTY_TYPES = ["movie", "episode", "video", "track"] as const;
export const MAX_PARTY_MEMBERS = 50;
/** How long a party survives without its host before it is ended. */
export const HOST_GRACE_MS = 90_000;
const PARTY_TTL_SECONDS = 24 * 60 * 60;
const PRESENCE_TTL_MS = 75_000;
const SWEEP_INTERVAL_MS = 15_000;
const COMMAND_LEAD_MS = 300;
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
	/** Position in seconds at `at`. */
	position: number;
	/** Server time (ms) when this version of the timeline becomes effective. */
	at: number;
	/** Increments for every accepted playback command. */
	version: number;
	playbackRate: number;
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

export type PartyMessage =
	| { type: "state"; party: PartySnapshot; serverTime: number }
	| { type: "chat"; message: PartyChatMessage }
	| { type: "chat-history"; messages: PartyChatMessage[] }
	| { type: "ended"; reason: "host-ended" | "host-left" };

export type PartyCommand =
	| { action: "play" | "pause"; commandId: string; itemId?: string }
	| { action: "seek"; commandId: string; itemId?: string; position: number }
	| { action: "change-item"; commandId: string; itemId: string };

interface PartyEvent {
	partyId: string;
	message: PartyMessage;
}

interface LocalConnection {
	presenceId: string;
	person: PartyPerson;
	send: (message: PartyMessage) => void;
}

const CONTROL_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
if not raw then return cjson.encode({error='missing'}) end
local party = cjson.decode(raw)
if party.host.id ~= ARGV[1] then return cjson.encode({error='forbidden'}) end
local command = cjson.decode(ARGV[2])
if party.lastCommandId == command.commandId then
  local time = redis.call('TIME')
  return cjson.encode({party=party, serverTime=(tonumber(time[1]) * 1000) + math.floor(tonumber(time[2]) / 1000)})
end
local count = redis.call('INCR', KEYS[2])
if count == 1 then redis.call('EXPIRE', KEYS[2], 5) end
if count > 30 then return cjson.encode({error='control-rate-limited'}) end
local time = redis.call('TIME')
local now = (tonumber(time[1]) * 1000) + math.floor(tonumber(time[2]) / 1000)
local delay = tonumber(ARGV[3])
local rate = tonumber(party.playbackRate) or 1
local position = tonumber(party.position) or 0
if party.playing then position = position + math.max(0, now - (tonumber(party.at) or now)) * rate / 1000 end
local itemChanged = false
if ARGV[4] ~= '' then
  local item = cjson.decode(ARGV[4])
  if ((item.type == 'track') ~= (party.kind == 'music')) then
    return cjson.encode({error='kind-mismatch'})
  end
  if item.id ~= party.item.id then
    party.item = item
    position = 0
    itemChanged = true
  end
end
if command.action == 'play' then
  if party.playing then position = position + delay * rate / 1000 end
  party.playing = true
elseif command.action == 'pause' then
  if party.playing then position = position + delay * rate / 1000 end
  party.playing = false
elseif command.action == 'seek' then
  if not itemChanged then
    position = math.max(0, math.min(tonumber(command.position) or 0, ${MAX_POSITION_SECONDS}))
  end
elseif command.action ~= 'change-item' then
  return cjson.encode({error='invalid-command'})
end
party.position = position
party.at = now + delay
party.version = (tonumber(party.version) or 0) + 1
party.lastCommandId = command.commandId
redis.call('SET', KEYS[1], cjson.encode(party), 'EX', ${PARTY_TTL_SECONDS})
local message = {type='state', party=party, serverTime=now}
redis.call('PUBLISH', KEYS[3], cjson.encode({partyId=party.id, message=message}))
return cjson.encode({party=party, serverTime=now})
`;

const PRESENCE_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
if not raw then return cjson.encode({error='missing'}) end
local party = cjson.decode(raw)
local time = redis.call('TIME')
local now = (tonumber(time[1]) * 1000) + math.floor(tonumber(time[2]) / 1000)
redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', now)
for _, id in ipairs(redis.call('HKEYS', KEYS[3])) do
  if not redis.call('ZSCORE', KEYS[2], id) then redis.call('HDEL', KEYS[3], id) end
end
local action = ARGV[1]
local connectionId = ARGV[2]
if action == 'join' then
  local unique = {}
  for _, id in ipairs(redis.call('ZRANGE', KEYS[2], 0, -1)) do
    local value = redis.call('HGET', KEYS[3], id)
    if value then unique[cjson.decode(value).id] = true end
  end
  if not unique[ARGV[3]] then
    local count = 0
    for _ in pairs(unique) do count = count + 1 end
    if count >= tonumber(ARGV[5]) then return cjson.encode({error='full'}) end
  end
  redis.call('ZADD', KEYS[2], now + tonumber(ARGV[4]), connectionId)
  redis.call('HSET', KEYS[3], connectionId, ARGV[6])
elseif action == 'leave' then
  redis.call('ZREM', KEYS[2], connectionId)
  redis.call('HDEL', KEYS[3], connectionId)
elseif action == 'renew' then
  if redis.call('ZSCORE', KEYS[2], connectionId) then
    redis.call('ZADD', KEYS[2], now + tonumber(ARGV[4]), connectionId)
  end
end
local members = cjson.decode('[]')
local seen = {}
for _, id in ipairs(redis.call('ZRANGE', KEYS[2], 0, -1)) do
  local value = redis.call('HGET', KEYS[3], id)
  if value then
    local person = cjson.decode(value)
    if not seen[person.id] then
      seen[person.id] = true
      table.insert(members, person)
    end
  end
end
party.members = members
redis.call('SET', KEYS[1], cjson.encode(party), 'EX', ${PARTY_TTL_SECONDS})
redis.call('EXPIRE', KEYS[2], ${PARTY_TTL_SECONDS})
redis.call('EXPIRE', KEYS[3], ${PARTY_TTL_SECONDS})
local message = {type='state', party=party, serverTime=now}
if action ~= 'renew' then
  redis.call('PUBLISH', KEYS[4], cjson.encode({partyId=party.id, message=message}))
elseif ARGV[7] == 'sweep' then
  redis.call('PUBLISH', KEYS[4], cjson.encode({partyId=party.id, message=message}))
end
return cjson.encode({party=party, serverTime=now})
`;

const CHAT_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
if not raw then return cjson.encode({error='missing'}) end
local isMember = false
for _, value in ipairs(redis.call('HVALS', KEYS[2])) do
  if cjson.decode(value).id == ARGV[1] then isMember = true; break end
end
if not isMember then return cjson.encode({error='not-member'}) end
local count = redis.call('INCR', KEYS[3])
if count == 1 then redis.call('EXPIRE', KEYS[3], 5) end
if count > 5 then return cjson.encode({error='rate-limited'}) end
local time = redis.call('TIME')
local now = (tonumber(time[1]) * 1000) + math.floor(tonumber(time[2]) / 1000)
local message = cjson.decode(ARGV[2])
message.at = now
local encoded = cjson.encode(message)
redis.call('LPUSH', KEYS[4], encoded)
redis.call('LTRIM', KEYS[4], 0, ${CHAT_HISTORY - 1})
redis.call('EXPIRE', KEYS[4], ${PARTY_TTL_SECONDS})
redis.call('PUBLISH', KEYS[5], cjson.encode({partyId=ARGV[3], message={type='chat', message=message}}))
return encoded
`;

const END_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
if not raw then return cjson.encode({error='missing'}) end
local party = cjson.decode(raw)
if ARGV[1] ~= '' and party.host.id ~= ARGV[1] then return cjson.encode({error='forbidden'}) end
redis.call('PUBLISH', KEYS[7], cjson.encode({partyId=party.id, message={type='ended', reason=ARGV[2]}}))
if redis.call('GET', KEYS[2]) == party.id then redis.call('DEL', KEYS[2]) end
if redis.call('GET', KEYS[3]) == party.id then redis.call('DEL', KEYS[3]) end
redis.call('SREM', KEYS[4], party.id)
redis.call('DEL', KEYS[1], KEYS[5], KEYS[6])
return cjson.encode({party=party})
`;

interface ScriptResult<T> {
	error?: string;
	party?: T;
	serverTime?: number;
}

function parseJson<T>(value: unknown): T {
	if (typeof value !== "string") {
		throw new Error("Redis returned an invalid party response.");
	}
	return JSON.parse(value) as T;
}

function stateKey(id: string): string {
	return `flixer:party:${id}:state`;
}

function presenceKey(id: string): string {
	return `flixer:party:${id}:presence`;
}

function peopleKey(id: string): string {
	return `flixer:party:${id}:people`;
}

function chatKey(id: string): string {
	return `flixer:party:${id}:chat`;
}

@Injectable()
export class PartiesService {
	private readonly connections = new Map<string, Set<LocalConnection>>();
	private readonly hostTimers = new Map<string, NodeJS.Timeout>();
	private sweepTimer?: NodeJS.Timeout;

	constructor(
		@Inject(DefaultDataSource) private readonly dataSource: DataSource,
		private readonly friends: FriendsService,
		private readonly partyRedis: PartyRedisService,
	) {}

	async $onInit(): Promise<void> {
		await this.partyRedis.start((message) => this.onRedisMessage(message));
		this.sweepTimer = setInterval(() => void this.sweep(), SWEEP_INTERVAL_MS);
		this.sweepTimer.unref();
	}

	async $onDestroy(): Promise<void> {
		clearInterval(this.sweepTimer);
		for (const timer of this.hostTimers.values()) clearTimeout(timer);
		this.hostTimers.clear();
		await this.partyRedis.stop();
	}

	async create(
		host: PartyPerson,
		itemId: string,
		visibility: "public" | "friends" | "private" = "public",
	): Promise<PartySnapshot> {
		const item = await this.loadItem(itemId);
		const client = this.partyRedis.commands;
		const currentId = await client.get(this.hostKey(host.id));
		if (currentId) await this.end(currentId, "host-ended");

		const now = await this.serverTime();
		const party: PartySnapshot = {
			id: randomBytes(6).toString("base64url"),
			kind: item.type === "track" ? "music" : "video",
			visibility,
			host,
			item,
			playing: false,
			position: 0,
			at: now,
			version: 0,
			playbackRate: 1,
			members: [host],
		};
		const id = party.id;
		const result = await client.set(stateKey(id), JSON.stringify(party), { EX: PARTY_TTL_SECONDS, NX: true });
		if (result !== "OK") throw new Error("Could not reserve a unique party identifier.");
		await client
			.multi()
			.set(this.hostKey(host.id), id, { EX: PARTY_TTL_SECONDS })
			.set(this.usernameKey(host.username), id, { EX: PARTY_TTL_SECONDS })
			.sAdd(this.activeKey(), id)
			.exec();
		return party;
	}

	async get(id: string, viewerId: string): Promise<PartySnapshot> {
		const party = await this.require(id);
		await this.requireAccess(party, viewerId, true);
		return this.refreshMembers(id);
	}

	async hostedBy(userId: string): Promise<PartySummary | null> {
		const id = await this.partyRedis.commands.get(this.hostKey(userId));
		if (!id) return null;
		const party = await this.read(id);
		return party?.visibility === "public" ? this.summary(await this.refreshMembers(id)) : null;
	}

	async hostedByUsername(username: string, viewerId: string): Promise<PartySummary | null> {
		const id = await this.partyRedis.commands.get(this.usernameKey(username));
		if (!id) return null;
		const party = await this.read(id);
		if (!party) return null;
		if (party.visibility === "private") return null;
		if (
			party.visibility === "friends" &&
			viewerId !== party.host.id &&
			!(await this.friends.areFriends(viewerId, party.host.id))
		) {
			return null;
		}
		return this.summary(await this.refreshMembers(id));
	}

	async join(
		id: string,
		person: PartyPerson,
		send: (message: PartyMessage) => void,
	): Promise<{
		snapshot: PartySnapshot;
		serverTime: number;
		leave: () => Promise<void>;
		renew: () => Promise<void>;
	}> {
		const party = await this.require(id);
		await this.requireAccess(party, person.id, true);
		const connection: LocalConnection = { presenceId: randomUUID(), person, send };
		const local = this.connections.get(id) ?? new Set<LocalConnection>();
		local.add(connection);
		this.connections.set(id, local);

		try {
			const result = await this.presence(id, "join", connection);
			if (party.host.id === person.id) this.clearHostTimer(id);
			return {
				snapshot: result.party,
				serverTime: result.serverTime,
				leave: () => this.leave(id, connection),
				renew: () => this.renew(id, connection),
			};
		} catch (error) {
			local.delete(connection);
			if (local.size === 0) this.connections.delete(id);
			throw error;
		}
	}

	async control(id: string, userId: string, command: PartyCommand): Promise<void> {
		const current = await this.require(id);
		if (current.host.id !== userId) throw new Forbidden("Only the host controls playback.");
		if (!/^[A-Za-z0-9_-]{1,64}$/.test(command.commandId)) {
			throw new BadRequest("A valid party command identifier is required.");
		}
		if (command.action === "change-item" && !command.itemId) {
			throw new BadRequest("An item is required to change party playback.");
		}
		if (command.action === "seek" && (!Number.isFinite(command.position) || command.position < 0)) {
			throw new BadRequest("A valid playback position is required.");
		}
		let item: SocialItem | undefined;
		if (command.itemId && command.itemId !== current.item.id) {
			item = await this.loadItem(command.itemId);
			if ((item.type === "track") !== (current.kind === "music")) {
				throw new BadRequest("A party cannot switch between video and music.");
			}
		}
		const result = parseJson<ScriptResult<PartySnapshot>>(
			await this.partyRedis.commands.eval(CONTROL_SCRIPT, {
				keys: [stateKey(id), `flixer:party:${id}:control:${userId}`, PARTY_EVENTS_CHANNEL],
				arguments: [userId, JSON.stringify(command), String(COMMAND_LEAD_MS), item ? JSON.stringify(item) : ""],
			}),
		);
		this.throwScriptError(result.error);
		if (!result.party) throw new Error("Redis did not return the updated party state.");
	}

	async chatHistory(id: string): Promise<PartyChatMessage[]> {
		const messages = await this.partyRedis.commands.lRange(chatKey(id), 0, CHAT_HISTORY - 1);
		return messages.reverse().map((message) => JSON.parse(message) as PartyChatMessage);
	}

	async chat(id: string, person: PartyPerson, rawText: string): Promise<void> {
		const text = rawText.replace(/\s+/g, " ").trim().slice(0, MAX_CHAT_LENGTH);
		if (text === "") return;
		const message = {
			id: randomBytes(6).toString("base64url"),
			from: person,
			text,
			at: 0,
		};
		const result = await this.partyRedis.commands.eval(CHAT_SCRIPT, {
			keys: [
				stateKey(id),
				peopleKey(id),
				`flixer:party:${id}:chat-rate:${person.id}`,
				chatKey(id),
				PARTY_EVENTS_CHANNEL,
			],
			arguments: [person.id, JSON.stringify(message), id],
		});
		const parsed = parseJson<ScriptResult<PartyChatMessage>>(result);
		this.throwScriptError(parsed.error);
	}

	async endBy(id: string, userId: string): Promise<void> {
		const party = await this.require(id);
		if (party.host.id !== userId) throw new Forbidden("Only the host can end the party.");
		await this.end(id, "host-ended");
	}

	private async end(id: string, reason: "host-ended" | "host-left"): Promise<void> {
		const party = await this.read(id);
		if (!party) return;
		const result = parseJson<ScriptResult<PartySnapshot>>(
			await this.partyRedis.commands.eval(END_SCRIPT, {
				keys: [
					stateKey(id),
					this.hostKey(party.host.id),
					this.usernameKey(party.host.username),
					this.activeKey(),
					presenceKey(id),
					peopleKey(id),
					PARTY_EVENTS_CHANNEL,
				],
				arguments: [party.host.id, reason],
			}),
		);
		this.throwScriptError(result.error);
		this.clearHostTimer(id);
	}

	private async leave(id: string, connection: LocalConnection): Promise<void> {
		const local = this.connections.get(id);
		local?.delete(connection);
		if (local?.size === 0) this.connections.delete(id);
		const result = await this.presence(id, "leave", connection).catch((error: unknown) => {
			logger().error({
				event: "PARTY_PRESENCE_LEAVE_FAILED",
				message: `Could not remove a party member from Redis: ${error instanceof Error ? error.message : String(error)}`,
			});
			return null;
		});
		if (result && !result.party.members.some((member) => member.id === result.party?.host.id)) {
			this.armHostTimer(id);
		}
	}

	private async renew(id: string, connection: LocalConnection): Promise<void> {
		await this.presence(id, "renew", connection);
	}

	private async presence(
		id: string,
		action: "join" | "leave" | "renew" | "sweep",
		connection?: LocalConnection,
	): Promise<{ party: PartySnapshot; serverTime: number }> {
		const person = connection?.person;
		const connectionId = connection?.presenceId ?? "";
		const result = parseJson<ScriptResult<PartySnapshot> & { serverTime: number }>(
			await this.partyRedis.commands.eval(PRESENCE_SCRIPT, {
				keys: [stateKey(id), presenceKey(id), peopleKey(id), PARTY_EVENTS_CHANNEL],
				arguments: [
					action === "sweep" ? "renew" : action,
					connectionId,
					person?.id ?? "",
					String(PRESENCE_TTL_MS),
					String(MAX_PARTY_MEMBERS),
					person ? JSON.stringify(person) : "",
					action,
				],
			}),
		);
		this.throwScriptError(result.error);
		if (!result.party || typeof result.serverTime !== "number") {
			throw new Error("Redis did not return the updated party presence.");
		}
		return { party: result.party, serverTime: result.serverTime };
	}

	private async refreshMembers(id: string): Promise<PartySnapshot> {
		return (await this.presence(id, "sweep")).party;
	}

	private async read(id: string): Promise<PartySnapshot | null> {
		const value = await this.partyRedis.commands.get(stateKey(id));
		return value ? (JSON.parse(value) as PartySnapshot) : null;
	}

	private async require(id: string): Promise<PartySnapshot> {
		const party = await this.read(id);
		if (!party) throw new NotFound("This party has ended.");
		return party;
	}

	private async requireAccess(party: PartySnapshot, viewerId: string, allowPrivateLink: boolean): Promise<void> {
		if (
			party.host.id === viewerId ||
			party.visibility === "public" ||
			(allowPrivateLink && party.visibility === "private")
		) {
			return;
		}
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

	async serverTime(): Promise<number> {
		const response = (await this.partyRedis.commands.sendCommand(["TIME"])) as string[];
		return Number(response[0]) * 1000 + Math.floor(Number(response[1]) / 1000);
	}

	private async sweep(): Promise<void> {
		try {
			const ids = await this.partyRedis.commands.sMembers(this.activeKey());
			for (const id of ids) {
				const result = await this.presence(id, "sweep").catch((error: unknown) => {
					logger().error({
						event: "PARTY_PRESENCE_SWEEP_FAILED",
						message: `Could not refresh party presence: ${error instanceof Error ? error.message : String(error)}`,
					});
					return null;
				});
				if (!result) continue;
				if (result.party.members.some((member) => member.id === result.party.host.id)) {
					this.clearHostTimer(id);
				} else {
					this.armHostTimer(id);
				}
			}
		} catch (error) {
			logger().error({
				event: "PARTY_SWEEP_FAILED",
				message: `Could not sweep party presence: ${error instanceof Error ? error.message : String(error)}`,
			});
		}
	}

	private onRedisMessage(raw: string): void {
		try {
			const event = JSON.parse(raw) as PartyEvent;
			if (!event.partyId || !event.message) return;
			for (const connection of this.connections.get(event.partyId) ?? []) {
				connection.send(event.message);
			}
			if (event.message.type === "state") {
				const hostPresent = event.message.party.members.some(
					(member) => member.id === event.message.party.host.id,
				);
				if (hostPresent) this.clearHostTimer(event.partyId);
				else this.armHostTimer(event.partyId);
			}
		} catch (error) {
			logger().error({
				event: "PARTY_REDIS_EVENT_INVALID",
				message: `Could not process a party Redis event: ${error instanceof Error ? error.message : String(error)}`,
			});
		}
	}

	private armHostTimer(id: string): void {
		if (this.hostTimers.has(id)) return;
		const timer = setTimeout(() => {
			this.hostTimers.delete(id);
			void this.endIfHostAbsent(id);
		}, HOST_GRACE_MS);
		timer.unref();
		this.hostTimers.set(id, timer);
	}

	private async endIfHostAbsent(id: string): Promise<void> {
		try {
			const party = await this.read(id);
			if (!party) return;
			const refreshed = await this.refreshMembers(id);
			if (!refreshed.members.some((member) => member.id === refreshed.host.id)) {
				await this.end(id, "host-left");
			}
		} catch (error) {
			logger().error({
				event: "PARTY_HOST_TIMEOUT_FAILED",
				message: `Could not check the party host presence: ${error instanceof Error ? error.message : String(error)}`,
			});
		}
	}

	private clearHostTimer(id: string): void {
		clearTimeout(this.hostTimers.get(id));
		this.hostTimers.delete(id);
	}

	private summary(party: PartySnapshot): PartySummary {
		return { id: party.id, kind: party.kind, title: party.item.title, memberCount: party.members.length };
	}

	private activeKey(): string {
		return "flixer:parties:active";
	}

	private hostKey(userId: string): string {
		return `flixer:party:host:${userId}`;
	}

	private usernameKey(username: string): string {
		return `flixer:party:username:${username.toLowerCase()}`;
	}

	private throwScriptError(error?: string): void {
		switch (error) {
			case undefined:
				return;
			case "missing":
				throw new NotFound("This party has ended.");
			case "forbidden":
				throw new Forbidden("Only the host controls playback.");
			case "full":
				throw new BadRequest("This party is full.");
			case "not-member":
				throw new Forbidden("Join the party to chat.");
			case "rate-limited":
				throw new TooManyRequests("You're sending messages too quickly.");
			case "control-rate-limited":
				throw new TooManyRequests("You're controlling playback too quickly.");
			case "kind-mismatch":
				throw new BadRequest("A party cannot switch between video and music.");
			default:
				throw new BadRequest("Invalid party command.");
		}
	}
}
