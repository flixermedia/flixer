import { Inject, Injectable, logger } from "@tsed/di";
import { BadRequest, Forbidden, NotFound, TooManyRequests } from "@tsed/exceptions";
import { randomUUID } from "node:crypto";
import { DataSource } from "typeorm";
import { DefaultDataSource } from "../datasources/defaultDataSource.datasource.js";
import { NotificationService } from "../api/notifications/notificationService.js";

export const MAX_MESSAGE_LENGTH = 2000;
export const MAX_GROUP_MEMBERS = 50;
export const MAX_GROUP_NAME = 60;
const PAGE_SIZE = 50;
const RATE_WINDOW_MS = 10_000;
const RATE_LIMIT = 10;
/** A member who fetched the thread this recently is looking at it, so a notification would be noise. */
const ACTIVE_MS = 15_000;

export interface ChatPerson {
	username: string;
	displayName: string;
	avatarUrl: string | null;
}

export interface ChatMember extends ChatPerson {
	role: "owner" | "member";
}

export interface ChatMessage {
	id: string;
	conversationId: string;
	kind: "text" | "system";
	body: string;
	sender: ChatPerson | null;
	createdAt: string;
}

export interface ChatConversation {
	id: string;
	kind: "direct" | "group";
	name: string | null;
	members: ChatMember[];
	lastMessage: ChatMessage | null;
	unread: number;
	updatedAt: string;
}

/** The stable key that makes one direct conversation per pair of people. */
export function directKey(a: string, b: string): string {
	return [a, b].sort().join(":");
}

/** Trims a message and rejects empty or oversized ones. */
export function cleanMessage(text: unknown): string {
	const body = typeof text === "string" ? text.replace(/\r\n/g, "\n").trim() : "";
	if (body.length === 0) {
		throw new BadRequest("Write a message first.");
	}
	if (body.length > MAX_MESSAGE_LENGTH) {
		throw new BadRequest(`Messages can be up to ${MAX_MESSAGE_LENGTH} characters.`);
	}
	return body;
}

export function cleanName(text: unknown): string {
	const name = typeof text === "string" ? text.trim().replace(/\s+/g, " ") : "";
	if (name.length === 0 || name.length > MAX_GROUP_NAME) {
		throw new BadRequest(`Group names are 1 to ${MAX_GROUP_NAME} characters.`);
	}
	return name;
}

const avatarUrl = (file: string | null) => (file ? `/auth/avatars/${file}` : null);

interface PersonRow {
	id: string;
	username: string;
	display_name: string | null;
	avatar_file: string | null;
}

const personOf = (row: PersonRow): ChatPerson => ({
	username: row.username,
	displayName: row.display_name || row.username,
	avatarUrl: avatarUrl(row.avatar_file),
});

interface MessageRow {
	id: string;
	conversation_id: string;
	kind: "text" | "system";
	body: string;
	created_at: Date;
	username: string | null;
	display_name: string | null;
	avatar_file: string | null;
}

const messageOf = (row: MessageRow): ChatMessage => ({
	id: row.id,
	conversationId: row.conversation_id,
	kind: row.kind,
	body: row.body,
	sender: row.username
		? personOf({ id: "", username: row.username, display_name: row.display_name, avatar_file: row.avatar_file })
		: null,
	createdAt: row.created_at.toISOString(),
});

const MESSAGE_SELECT = `SELECT m.id, m.conversation_id, m.kind, m.body, m.created_at, u.username, u.display_name, up.avatar_file
	FROM chat_messages m LEFT JOIN users u ON u.id = m.user_id LEFT JOIN user_preferences up ON up.user_id = u.id`;

/** Direct messages and group chats between the people on this server. */
@Injectable()
export class ChatService {

	private readonly recentSends = new Map<string, number[]>();

	constructor(
		@Inject(DefaultDataSource) private readonly dataSource: DataSource,
		private readonly notifications: NotificationService,
	) {}

	async conversations(userId: string): Promise<{ conversations: ChatConversation[]; unread: number }> {
		const ids = (await this.dataSource.query(
			`SELECT c.id FROM chat_conversations c JOIN chat_members m ON m.conversation_id = c.id
			WHERE m.user_id = $1 ORDER BY c.last_message_at DESC LIMIT 200`,
			[userId],
		)) as Array<{ id: string }>;
		const conversations = await this.summaries(
			userId,
			ids.map((row) => row.id),
		);
		return { conversations, unread: conversations.reduce((total, item) => total + item.unread, 0) };
	}

	async conversation(userId: string, id: string): Promise<ChatConversation> {
		await this.assertMember(userId, id);
		return (await this.summaries(userId, [id]))[0];
	}

	async startDirect(userId: string, username: string): Promise<ChatConversation> {
		const [other] = await this.resolve([username]);
		if (other.id === userId) {
			throw new BadRequest("You can't message yourself.");
		}
		const key = directKey(userId, other.id);
		const existing = (await this.dataSource.query(`SELECT id FROM chat_conversations WHERE direct_key = $1`, [
			key,
		])) as Array<{ id: string }>;
		if (existing[0]) {
			return this.conversation(userId, existing[0].id);
		}
		const id = randomUUID();
		await this.dataSource.transaction(async (manager) => {
			await manager.query(
				`INSERT INTO chat_conversations (id, kind, direct_key, created_by) VALUES ($1, 'direct', $2, $3)`,
				[id, key, userId],
			);
			await manager.query(
				`INSERT INTO chat_members (conversation_id, user_id, role) VALUES ($1, $2, 'member'), ($1, $3, 'member')`,
				[id, userId, other.id],
			);
		});
		return this.conversation(userId, id);
	}

	async createGroup(userId: string, name: unknown, usernames: string[]): Promise<ChatConversation> {
		const title = cleanName(name);
		const others = (await this.resolve(usernames)).filter((person) => person.id !== userId);
		if (others.length === 0) {
			throw new BadRequest("Pick at least one other person.");
		}
		if (others.length + 1 > MAX_GROUP_MEMBERS) {
			throw new BadRequest(`Groups can have up to ${MAX_GROUP_MEMBERS} people.`);
		}
		const id = randomUUID();
		await this.dataSource.transaction(async (manager) => {
			await manager.query(
				`INSERT INTO chat_conversations (id, kind, name, created_by) VALUES ($1, 'group', $2, $3)`,
				[id, title, userId],
			);
			await manager.query(`INSERT INTO chat_members (conversation_id, user_id, role) VALUES ($1, $2, 'owner')`, [
				id,
				userId,
			]);
			for (const person of others) {
				await manager.query(
					`INSERT INTO chat_members (conversation_id, user_id, role) VALUES ($1, $2, 'member')`,
					[id, person.id],
				);
			}
		});
		await this.system(id, userId, `created the group "${title}"`);
		return this.conversation(userId, id);
	}

	async rename(userId: string, id: string, name: unknown): Promise<ChatConversation> {
		const member = await this.assertMember(userId, id);
		if (member.kind !== "group") {
			throw new BadRequest("Only groups can be renamed.");
		}
		const title = cleanName(name);
		await this.dataSource.query(`UPDATE chat_conversations SET name = $2 WHERE id = $1`, [id, title]);
		await this.system(id, userId, `renamed the group to "${title}"`);
		return this.conversation(userId, id);
	}

	async addMembers(userId: string, id: string, usernames: string[]): Promise<ChatConversation> {
		const member = await this.assertMember(userId, id);
		if (member.kind !== "group") {
			throw new BadRequest("People can only be added to groups.");
		}
		const people = await this.resolve(usernames);
		const current = (await this.dataSource.query(`SELECT user_id FROM chat_members WHERE conversation_id = $1`, [
			id,
		])) as Array<{ user_id: string }>;
		const have = new Set(current.map((row) => row.user_id));
		const fresh = people.filter((person) => !have.has(person.id));
		if (have.size + fresh.length > MAX_GROUP_MEMBERS) {
			throw new BadRequest(`Groups can have up to ${MAX_GROUP_MEMBERS} people.`);
		}
		for (const person of fresh) {
			await this.dataSource.query(
				`INSERT INTO chat_members (conversation_id, user_id, role) VALUES ($1, $2, 'member') ON CONFLICT DO NOTHING`,
				[id, person.id],
			);
			await this.system(id, userId, `added ${person.display_name || person.username}`);
		}
		return this.conversation(userId, id);
	}

	/** Leaves a group, or removes someone else when the caller owns it. */
	async removeMember(userId: string, id: string, username: string): Promise<void> {
		const member = await this.assertMember(userId, id);
		if (member.kind !== "group") {
			throw new BadRequest("You can't leave a direct conversation.");
		}
		const target = (await this.dataSource.query(
			`SELECT u.id, u.username, u.display_name, m.role FROM chat_members m JOIN users u ON u.id = m.user_id
			WHERE m.conversation_id = $1 AND lower(u.username) = lower($2)`,
			[id, username],
		)) as Array<{ id: string; username: string; display_name: string | null; role: string }>;
		if (!target[0]) {
			throw new NotFound("That person isn't in this group.");
		}
		const leaving = target[0].id === userId;
		if (!leaving && member.role !== "owner") {
			throw new Forbidden("Only the group owner can remove people.");
		}
		await this.dataSource.query(`DELETE FROM chat_members WHERE conversation_id = $1 AND user_id = $2`, [
			id,
			target[0].id,
		]);
		const remaining = (await this.dataSource.query(
			`SELECT user_id, role FROM chat_members WHERE conversation_id = $1 ORDER BY joined_at ASC`,
			[id],
		)) as Array<{ user_id: string; role: string }>;
		if (remaining.length === 0) {
			await this.dataSource.query(`DELETE FROM chat_conversations WHERE id = $1`, [id]);
			return;
		}
		if (!remaining.some((row) => row.role === "owner")) {
			await this.dataSource.query(
				`UPDATE chat_members SET role = 'owner' WHERE conversation_id = $1 AND user_id = $2`,
				[id, remaining[0].user_id],
			);
		}
		const name = target[0].display_name || target[0].username;
		await this.system(id, null, leaving ? `${name} left` : `${name} was removed`);
	}

	/** Messages oldest first. `before` pages back through history, `after` fetches what arrived since. Fetching marks the thread read. */
	async messages(userId: string, id: string, options: { before?: string; after?: string }): Promise<{ messages: ChatMessage[]; hasMore: boolean }> {
		await this.assertMember(userId, id);
		const before = this.date(options.before);
		const after = this.date(options.after);
		const params: unknown[] = [id];
		let where = "m.conversation_id = $1";
		if (before) {
			params.push(before);
			where += ` AND m.created_at < $${params.length}`;
		}
		if (after) {
			params.push(after);
			where += ` AND m.created_at > $${params.length}`;
		}
		const rows = (await this.dataSource.query(
			`${MESSAGE_SELECT} WHERE ${where} ORDER BY m.created_at ${after ? "ASC" : "DESC"} LIMIT ${PAGE_SIZE + 1}`,
			params,
		)) as MessageRow[];
		const hasMore = rows.length > PAGE_SIZE;
		const page = rows.slice(0, PAGE_SIZE).map(messageOf);
		await this.markRead(userId, id);
		return { messages: after ? page : page.reverse(), hasMore: after ? false : hasMore };
	}

	async markRead(userId: string, id: string): Promise<void> {
		await this.dataSource.query(
			`UPDATE chat_members SET last_read_at = now() WHERE conversation_id = $1 AND user_id = $2`,
			[id, userId],
		);
		await this.dataSource
			.query(
				`DELETE FROM notifications WHERE user_id = $1 AND kind = 'message' AND url = $2`,
				[userId, `/chat/${id}`],
			)
			.catch(() => undefined);
	}

	async send(userId: string, id: string, text: unknown): Promise<ChatMessage> {
		const body = cleanMessage(text);
		await this.assertMember(userId, id);
		this.throttle(userId);
		const messageId = randomUUID();
		await this.dataSource.query(
			`INSERT INTO chat_messages (id, conversation_id, user_id, kind, body) VALUES ($1, $2, $3, 'text', $4)`,
			[messageId, id, userId, body],
		);
		await this.dataSource.query(`UPDATE chat_conversations SET last_message_at = now() WHERE id = $1`, [id]);
		await this.dataSource.query(
			`UPDATE chat_members SET last_read_at = now() WHERE conversation_id = $1 AND user_id = $2`,
			[id, userId],
		);
		const row = (await this.dataSource.query(`${MESSAGE_SELECT} WHERE m.id = $1`, [messageId])) as MessageRow[];
		const message = messageOf(row[0]);
		await this.notify(id, userId, message).catch((error: unknown) =>
			logger().warn("Could not notify chat members.", error),
		);
		return message;
	}

	/** Unread messages across every conversation, for the navbar badge. */
	async unreadCount(userId: string): Promise<number> {
		const rows = (await this.dataSource.query(
			`SELECT count(*)::int AS n FROM chat_messages msg JOIN chat_members m ON m.conversation_id = msg.conversation_id
			WHERE m.user_id = $1 AND msg.kind = 'text' AND msg.created_at > m.last_read_at AND msg.user_id IS DISTINCT FROM $1`,
			[userId],
		)) as Array<{ n: number }>;
		return rows[0]?.n ?? 0;
	}

	private async notify(id: string, senderId: string, message: ChatMessage): Promise<void> {
		const recipients = (await this.dataSource.query(
			`SELECT m.user_id FROM chat_members m JOIN users u ON u.id = m.user_id
			WHERE m.conversation_id = $1 AND m.user_id <> $2 AND u.disabled_at IS NULL
			AND m.last_read_at < now() - ($3 || ' milliseconds')::interval`,
			[id, senderId, String(ACTIVE_MS)],
		)) as Array<{ user_id: string }>;
		if (recipients.length === 0) {
			return;
		}
		const info = (await this.dataSource.query(`SELECT kind, name FROM chat_conversations WHERE id = $1`, [
			id,
		])) as Array<{ kind: string; name: string | null }>;
		const sender = message.sender?.displayName ?? "Someone";
		const title = info[0]?.kind === "group" ? `${info[0].name}` : sender;
		const body = info[0]?.kind === "group" ? `${sender}: ${message.body}` : message.body;
		const ids = recipients.map((row) => row.user_id);
		const url = `/chat/${id}`;
		// One inbox entry per conversation: a newer message replaces the unread one instead of piling up.
		await this.dataSource.query(
			`DELETE FROM notifications WHERE kind = 'message' AND url = $1 AND read_at IS NULL AND user_id = ANY($2::uuid[])`,
			[url, ids],
		);
		await this.notifications.send({ kind: "message", title, body: body.slice(0, 500), url }, ids);
	}

	private throttle(userId: string): void {
		const now = Date.now();
		const recent = (this.recentSends.get(userId) ?? []).filter((at) => now - at < RATE_WINDOW_MS);
		if (recent.length >= RATE_LIMIT) {
			throw new TooManyRequests("You're sending messages too quickly.");
		}
		recent.push(now);
		this.recentSends.set(userId, recent);
	}

	private date(value: string | undefined): Date | null {
		if (!value) {
			return null;
		}
		const parsed = new Date(value);
		if (Number.isNaN(parsed.getTime())) {
			throw new BadRequest("That timestamp isn't valid.");
		}
		return parsed;
	}

	private async system(conversationId: string, userId: string | null, body: string): Promise<void> {
		await this.dataSource.query(
			`INSERT INTO chat_messages (id, conversation_id, user_id, kind, body) VALUES ($1, $2, $3, 'system', $4)`,
			[randomUUID(), conversationId, userId, body.slice(0, MAX_MESSAGE_LENGTH)],
		);
		await this.dataSource.query(`UPDATE chat_conversations SET last_message_at = now() WHERE id = $1`, [
			conversationId,
		]);
	}

	private async assertMember(userId: string, id: string): Promise<{ kind: "direct" | "group"; role: string }> {
		const rows = (await this.dataSource.query(
			`SELECT c.kind, m.role FROM chat_conversations c JOIN chat_members m ON m.conversation_id = c.id
			WHERE c.id = $1 AND m.user_id = $2`,
			[id, userId],
		)) as Array<{ kind: "direct" | "group"; role: string }>;
		if (!rows[0]) {
			throw new NotFound("Conversation not found.");
		}
		return rows[0];
	}

	/** Finds active, visible people by username. Hidden profiles can't be started a chat with. */
	private async resolve(usernames: string[]): Promise<PersonRow[]> {
		const names = [...new Set(usernames.map((name) => String(name).trim().toLowerCase()).filter(Boolean))].slice(
			0,
			MAX_GROUP_MEMBERS,
		);
		if (names.length === 0) {
			throw new BadRequest("Pick at least one person.");
		}
		const rows = (await this.dataSource.query(
			`SELECT u.id, u.username, u.display_name, up.avatar_file FROM users u LEFT JOIN user_preferences up ON up.user_id = u.id
			WHERE lower(u.username) = ANY($1::text[]) AND u.disabled_at IS NULL AND COALESCE(up.profile_hidden, false) = false`,
			[names],
		)) as PersonRow[];
		if (rows.length !== names.length) {
			throw new NotFound("One of those people couldn't be found.");
		}
		return rows;
	}

	private async summaries(userId: string, ids: string[]): Promise<ChatConversation[]> {
		if (ids.length === 0) {
			return [];
		}
		const [conversations, members, lastMessages, unread] = await Promise.all([
			this.dataSource.query(`SELECT id, kind, name, last_message_at FROM chat_conversations WHERE id = ANY($1::uuid[])`, [ids]),
			this.dataSource.query(
				`SELECT m.conversation_id, m.role, u.id, u.username, u.display_name, up.avatar_file
				FROM chat_members m JOIN users u ON u.id = m.user_id LEFT JOIN user_preferences up ON up.user_id = u.id
				WHERE m.conversation_id = ANY($1::uuid[]) ORDER BY m.joined_at ASC`,
				[ids],
			),
			this.dataSource.query(
				`${MESSAGE_SELECT.replace("SELECT", "SELECT DISTINCT ON (m.conversation_id)")} WHERE m.conversation_id = ANY($1::uuid[]) ORDER BY m.conversation_id, m.created_at DESC`,
				[ids],
			),
			this.dataSource.query(
				`SELECT msg.conversation_id, count(*)::int AS n FROM chat_messages msg
				JOIN chat_members m ON m.conversation_id = msg.conversation_id AND m.user_id = $1
				WHERE msg.conversation_id = ANY($2::uuid[]) AND msg.kind = 'text' AND msg.created_at > m.last_read_at AND msg.user_id IS DISTINCT FROM $1
				GROUP BY msg.conversation_id`,
				[userId, ids],
			),
		]);
		const membersBy = new Map<string, ChatMember[]>();
		for (const row of members as Array<PersonRow & { conversation_id: string; role: "owner" | "member" }>) {
			const list = membersBy.get(row.conversation_id) ?? [];
			list.push({ ...personOf(row), role: row.role });
			membersBy.set(row.conversation_id, list);
		}
		const lastBy = new Map((lastMessages as MessageRow[]).map((row) => [row.conversation_id, messageOf(row)]));
		const unreadBy = new Map((unread as Array<{ conversation_id: string; n: number }>).map((row) => [row.conversation_id, row.n]));
		return (conversations as Array<{ id: string; kind: "direct" | "group"; name: string | null; last_message_at: Date }>)
			.map((row) => ({
				id: row.id,
				kind: row.kind,
				name: row.name,
				members: membersBy.get(row.id) ?? [],
				lastMessage: lastBy.get(row.id) ?? null,
				unread: unreadBy.get(row.id) ?? 0,
				updatedAt: row.last_message_at.toISOString(),
			}))
			.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
	}
}
