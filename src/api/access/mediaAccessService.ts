import { Inject, Injectable } from "@tsed/di";
import { BadRequest, Forbidden, NotFound, TooManyRequests } from "@tsed/exceptions";
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { DataSource, type SelectQueryBuilder, type ObjectLiteral } from "typeorm";
import { DefaultDataSource } from "../../datasources/defaultDataSource.datasource.js";
import { MediaItem } from "../../entities/mediaItem.entity.js";
import { MediaLibrary } from "../../entities/mediaLibrary.entity.js";
import { Setting } from "../../entities/setting.entity.js";
import { UserAccessPolicy, type AccessSchedule, type LibraryAccessMode } from "../../entities/userAccessPolicy.entity.js";
import { UserSession } from "../../entities/userSession.entity.js";
import { User } from "../../entities/user.entity.js";
import { AuthService } from "../auth/authService.js";
import { RATING_LIMITS, ratingAgeSql } from "./contentRatings.js";

export type RestrictedDisplay = "hidden" | "locked";
export type BlockReason = "library" | "rating" | "unrated" | "tags";

export const UNLOCK_MINUTES = 30;
const PIN_PATTERN = /^\d{6}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const MAX_TAGS = 50;
const VIDEO_TYPES = ["movie", "series", "season", "episode", "video"];
const TOP_LEVEL_TYPES = ["movie", "series", "album", "video"];
const PIN_ATTEMPTS = 5;
const PIN_LOCKOUT_MS = 5 * 60_000;

/** The restrictions that apply to one caller right now, with the unlock state of their device already folded in. */
export interface AccessPolicy {
	userId: string;
	sessionId: string | null;
	/** Allowed library ids, or null when every library is allowed. */
	libraryIds: string[] | null;
	maxAge: number | null;
	blockUnrated: boolean;
	allowedTags: string[];
	blockedTags: string[];
	schedule: AccessSchedule | null;
	requireRequestApproval: boolean;
	hasPin: boolean;
	unlockedUntil: Date | null;
	displayMode: RestrictedDisplay;
	/** True when restrictions are configured and this device has not unlocked them. */
	enforced: boolean;
}

export interface AccessPolicyDto {
	libraryMode: LibraryAccessMode;
	libraryIds: string[];
	maxAge: number | null;
	blockUnrated: boolean;
	allowedTags: string[];
	blockedTags: string[];
	schedule: AccessSchedule | null;
	requireRequestApproval: boolean;
	hasPin: boolean;
}

export interface AccessPolicyInput {
	libraryMode?: LibraryAccessMode;
	libraryIds?: string[];
	maxAge?: number | null;
	blockUnrated?: boolean;
	allowedTags?: string[];
	blockedTags?: string[];
	schedule?: AccessSchedule | null;
	requireRequestApproval?: boolean;
	/** undefined keeps the PIN, null removes it, a string sets it. */
	pin?: string | null;
}

interface Condition {
	sql: string;
	params: Record<string, unknown>;
}

const EMPTY: AccessPolicyDto = {
	libraryMode: "all",
	libraryIds: [],
	maxAge: null,
	blockUnrated: false,
	allowedTags: [],
	blockedTags: [],
	schedule: null,
	requireRequestApproval: false,
	hasPin: false,
};

function derivePinKey(pin: string, salt: Buffer): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		scrypt(pin, salt, 32, { N: 16384 }, (error, key) => (error ? reject(error) : resolve(key)));
	});
}

function minutesOf(time: string): number {
	return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
}

/** Whether `windows` allow viewing at the given weekday (0 = Sunday) and minute of the day. */
export function scheduleAllows(schedule: AccessSchedule | null, day: number, minute: number): boolean {
	if (!schedule || schedule.windows.length === 0) return true;
	return schedule.windows.some((window) => {
		const from = minutesOf(window.from);
		const to = minutesOf(window.to);
		if (from === to) return window.days.includes(day);
		if (from < to) return window.days.includes(day) && minute >= from && minute < to;
		// Overnight window: the tail of it falls on the next day.
		return (window.days.includes(day) && minute >= from) || (window.days.includes((day + 6) % 7) && minute < to);
	});
}

function localParts(at: Date, timezone: string): { day: number; minute: number } {
	const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(at);
	const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
	const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(value("weekday"));
	return { day, minute: Number(value("hour")) * 60 + Number(value("minute")) };
}

export interface ScheduleStatus {
	allowed: boolean;
	/** When viewing is next allowed, if it is not allowed now. */
	nextAllowedAt: string | null;
}

export function scheduleStatus(schedule: AccessSchedule | null, now = new Date()): ScheduleStatus {
	if (!schedule || schedule.windows.length === 0) return { allowed: true, nextAllowedAt: null };
	const check = (at: Date) => {
		const { day, minute } = localParts(at, schedule.timezone);
		return scheduleAllows(schedule, day, minute);
	};
	if (check(now)) return { allowed: true, nextAllowedAt: null };
	for (let step = 1; step <= 7 * 24 * 4; step++) {
		const at = new Date(now.getTime() + step * 15 * 60_000);
		if (check(at)) return { allowed: false, nextAllowedAt: at.toISOString() };
	}
	return { allowed: false, nextAllowedAt: null };
}

/** Decides what each user may see and play, and applies those rules inside the media queries. */
@Injectable()
export class MediaAccessService {

	constructor(
		@Inject(DefaultDataSource) private readonly dataSource: DataSource,
		private readonly authService: AuthService,
	) {}

	private readonly pinAttempts = new Map<string, { count: number; lockedUntil: number }>();

	async resolve(authorization?: string): Promise<AccessPolicy> {
		const { user, session } = await this.authService.getSessionContext(authorization);
		return this.load(user.id, session);
	}

	/** The policy for a user outside a request, such as an administrator previewing their view. */
	async forUser(userId: string): Promise<AccessPolicy> {
		return this.load(userId, null);
	}

	private async load(userId: string, session: UserSession | null): Promise<AccessPolicy> {
		const row = await this.dataSource.getRepository(UserAccessPolicy).findOneBy({ userId });
		const displayMode = await this.displayMode();
		const policy = row ?? undefined;
		const unlockedUntil = session?.accessUnlockedUntil && session.accessUnlockedUntil.getTime() > Date.now() ? session.accessUnlockedUntil : null;
		const hasRules = Boolean(policy && (policy.libraryMode === "selected" || policy.maxAge !== null || policy.blockUnrated || policy.allowedTags.length > 0 || policy.blockedTags.length > 0 || (policy.schedule && policy.schedule.windows.length > 0)));
		return {
			userId,
			sessionId: session?.id ?? null,
			libraryIds: policy?.libraryMode === "selected" ? policy.libraryIds : null,
			maxAge: policy?.maxAge ?? null,
			blockUnrated: policy?.blockUnrated ?? false,
			allowedTags: policy?.allowedTags ?? [],
			blockedTags: policy?.blockedTags ?? [],
			schedule: policy?.schedule ?? null,
			requireRequestApproval: policy?.requireRequestApproval ?? false,
			hasPin: Boolean(policy?.pinHash),
			unlockedUntil,
			displayMode,
			enforced: hasRules && unlockedUntil === null,
		};
	}

	async displayMode(): Promise<RestrictedDisplay> {
		const setting = await this.dataSource.getRepository(Setting).findOneBy({ key: "restricted_media_display" });
		return setting?.value === "locked" ? "locked" : "hidden";
	}

	// --- SQL conditions -------------------------------------------------------------------------------------

	private libraryCondition(alias: string, policy: AccessPolicy): Condition | null {
		if (!policy.enforced || policy.libraryIds === null) return null;
		if (policy.libraryIds.length === 0) return { sql: "1 = 0", params: {} };
		return { sql: `${alias}.library_id IN (:...accLibs)`, params: { accLibs: policy.libraryIds } };
	}

	private effectiveRating(alias: string): string {
		const clean = (column: string) => `NULLIF(btrim(${column}), '')`;
		return `COALESCE(${clean(`${alias}.metadata ->> 'contentRating'`)}, (SELECT ${clean("p.metadata ->> 'contentRating'")} FROM media_items p WHERE p.id = ${alias}.parent_id), (SELECT ${clean("g.metadata ->> 'contentRating'")} FROM media_items p JOIN media_items g ON g.id = p.parent_id WHERE p.id = ${alias}.parent_id))`;
	}

	private ratingCondition(alias: string, policy: AccessPolicy): Condition | null {
		if (!policy.enforced || policy.maxAge === null) return null;
		const age = ratingAgeSql(this.effectiveRating(alias));
		return { sql: `(${age} IS NULL OR ${age} <= :accMaxAge)`, params: { accMaxAge: policy.maxAge } };
	}

	private unratedCondition(alias: string, policy: AccessPolicy): Condition | null {
		if (!policy.enforced || !policy.blockUnrated) return null;
		const age = ratingAgeSql(this.effectiveRating(alias));
		const types = VIDEO_TYPES.map((type) => `'${type}'`).join(", ");
		return { sql: `(${alias}.type NOT IN (${types}) OR ${age} IS NOT NULL)`, params: {} };
	}

	private hasTag(alias: string, param: string): string {
		const list = (column: string) => `CASE WHEN jsonb_typeof(${column}) = 'array' THEN ${column} ELSE '[]'::jsonb END`;
		return `EXISTS (SELECT 1 FROM media_items t WHERE t.id IN (${alias}.id, ${alias}.parent_id, (SELECT p.parent_id FROM media_items p WHERE p.id = ${alias}.parent_id)) AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(${list("t.metadata -> 'genres'")} || ${list("t.metadata -> 'tags'")}) v WHERE lower(btrim(v)) = ANY(:${param})))`;
	}

	private tagCondition(alias: string, policy: AccessPolicy): Condition | null {
		if (!policy.enforced) return null;
		const parts: string[] = [];
		const params: Record<string, unknown> = {};
		if (policy.blockedTags.length > 0) {
			parts.push(`NOT ${this.hasTag(alias, "accBlocked")}`);
			params.accBlocked = policy.blockedTags;
		}
		if (policy.allowedTags.length > 0) {
			parts.push(this.hasTag(alias, "accAllowed"));
			params.accAllowed = policy.allowedTags;
		}
		return parts.length > 0 ? { sql: parts.join(" AND "), params } : null;
	}

	private contentConditions(alias: string, policy: AccessPolicy): Condition[] {
		return [this.ratingCondition(alias, policy), this.unratedCondition(alias, policy), this.tagCondition(alias, policy)].filter((condition): condition is Condition => condition !== null);
	}

	private join(conditions: Condition[]): Condition | null {
		if (conditions.length === 0) return null;
		return { sql: conditions.map((condition) => `(${condition.sql})`).join(" AND "), params: Object.assign({}, ...conditions.map((condition) => condition.params)) };
	}

	/**
	 * Restricts a media query to what the caller may see. Libraries are always hidden; rating and tag limits are hidden
	 * too unless the admin chose to show them locked, in which case `markLocked` flags the cards instead.
	 */
	restrict<T extends ObjectLiteral>(query: SelectQueryBuilder<T>, alias: string, policy: AccessPolicy, options: { content?: boolean } = {}): SelectQueryBuilder<T> {
		const conditions: Condition[] = [];
		const library = this.libraryCondition(alias, policy);
		if (library) conditions.push(library);
		if (options.content ?? policy.displayMode === "hidden") conditions.push(...this.contentConditions(alias, policy));
		const combined = this.join(conditions);
		if (combined) query.andWhere(combined.sql, combined.params);
		return query;
	}

	/** The same restriction for hand-written SQL. Parameters are named acc* and must be passed to the query. */
	restrictionSql(alias: string, policy: AccessPolicy, options: { content?: boolean } = {}): Condition {
		const conditions: Condition[] = [];
		const library = this.libraryCondition(alias, policy);
		if (library) conditions.push(library);
		if (options.content ?? policy.displayMode === "hidden") conditions.push(...this.contentConditions(alias, policy));
		return this.join(conditions) ?? { sql: "TRUE", params: {} };
	}

	// --- item checks ----------------------------------------------------------------------------------------

	/** Why an item is blocked for this policy, or null when it is allowed. */
	async blockReason(policy: AccessPolicy, itemId: string): Promise<BlockReason | null> {
		if (!policy.enforced) return null;
		const reasons = await this.blockReasons(policy, [itemId]);
		return reasons.get(itemId) ?? null;
	}

	private async blockReasons(policy: AccessPolicy, ids: string[]): Promise<Map<string, BlockReason>> {
		const result = new Map<string, BlockReason>();
		if (!policy.enforced || ids.length === 0) return result;
		const checks: Array<[BlockReason, Condition | null]> = [
			["library", this.libraryCondition("item", policy)],
			["rating", this.ratingCondition("item", policy)],
			["unrated", this.unratedCondition("item", policy)],
			["tags", this.tagCondition("item", policy)],
		];
		const active = checks.filter((check): check is [BlockReason, Condition] => check[1] !== null);
		if (active.length === 0) return result;
		const params: Record<string, unknown> = { accIds: ids };
		for (const [, condition] of active) Object.assign(params, condition.params);
		const reasonSql = active.map(([reason, condition]) => `WHEN NOT (${condition.sql}) THEN '${reason}'`).join(" ");
		const rows = await this.dataSource
			.getRepository(MediaItem)
			.createQueryBuilder("item")
			.select("item.id", "id")
			.addSelect(`CASE ${reasonSql} END`, "reason")
			.where("item.id IN (:...accIds)", params)
			.getRawMany<{ id: string; reason: BlockReason | null }>();
		for (const row of rows) if (row.reason) result.set(row.id, row.reason);
		return result;
	}

	async isVisible(policy: AccessPolicy, itemId: string): Promise<boolean> {
		return (await this.blockReason(policy, itemId)) === null;
	}

	/** In locked mode, lists keep rating- and tag-blocked items; this marks them so the client shows a lock. */
	async markLocked<T extends { id: string }>(policy: AccessPolicy, cards: T[]): Promise<Array<T & { locked?: true; lockReason?: BlockReason }>> {
		if (!policy.enforced || policy.displayMode !== "locked" || cards.length === 0) return cards;
		const reasons = await this.blockReasons(policy, cards.map((card) => card.id));
		return cards.map((card) => {
			const reason = reasons.get(card.id);
			return reason && reason !== "library" ? { ...card, locked: true as const, lockReason: reason } : card;
		});
	}

	/** Applies the caller's display mode to a list of cards: blocked ones disappear, or are flagged in locked mode. */
	async shape<T extends { id: string }>(policy: AccessPolicy, cards: T[]): Promise<Array<T & { locked?: true; lockReason?: BlockReason }>> {
		if (!policy.enforced || cards.length === 0) return cards;
		const reasons = await this.blockReasons(policy, cards.map((card) => card.id));
		return cards.flatMap((card) => {
			const reason = reasons.get(card.id);
			if (!reason) return [card];
			if (reason === "library" || policy.displayMode === "hidden") return [];
			return [{ ...card, locked: true as const, lockReason: reason }];
		});
	}

	/** Drops ids the caller may not see (always, regardless of display mode). */
	async visibleIds(policy: AccessPolicy, ids: string[]): Promise<Set<string>> {
		if (!policy.enforced) return new Set(ids);
		const blocked = await this.blockReasons(policy, ids);
		return new Set(ids.filter((id) => !blocked.has(id)));
	}

	assertSchedule(policy: AccessPolicy): void {
		if (!policy.enforced) return;
		const status = scheduleStatus(policy.schedule);
		if (!status.allowed) {
			throw new Forbidden("Playback isn't allowed at this time.", { code: "outside_allowed_hours", nextAllowedAt: status.nextAllowedAt } as never);
		}
	}

	/** Refuses playback of blocked media or outside the allowed hours. */
	async assertPlayable(policy: AccessPolicy, itemId: string): Promise<void> {
		this.assertSchedule(policy);
		const reason = await this.blockReason(policy, itemId);
		if (reason) {
			throw new Forbidden(reason === "library" ? "This media isn't available to your account." : "This media is restricted for your account.");
		}
	}

	// --- self service ---------------------------------------------------------------------------------------

	describeSelf(policy: AccessPolicy) {
		const status = scheduleStatus(policy.enforced ? policy.schedule : null);
		return {
			enforced: policy.enforced,
			hasPin: policy.hasPin,
			unlockedUntil: policy.unlockedUntil,
			displayMode: policy.displayMode,
			maxAge: policy.maxAge,
			requireRequestApproval: policy.requireRequestApproval,
			schedule: { allowed: status.allowed, nextAllowedAt: status.nextAllowedAt },
		};
	}

	async unlock(policy: AccessPolicy, pin: string): Promise<{ unlockedUntil: Date }> {
		if (!policy.sessionId) throw new BadRequest("Unlocking needs a signed-in device.");
		// Per user, not per session: signing in again must not reset the guess counter.
		const attemptKey = policy.userId;
		const attempts = this.pinAttempts.get(attemptKey);
		if (attempts && attempts.lockedUntil > Date.now()) {
			throw new TooManyRequests("Too many incorrect PINs. Try again in a few minutes.");
		}
		const row = await this.dataSource.getRepository(UserAccessPolicy).findOneBy({ userId: policy.userId });
		if (!row?.pinHash) throw new BadRequest("No PIN has been set for this account.");
		const [saltHex, hashHex] = row.pinHash.split(":");
		const expected = Buffer.from(hashHex ?? "", "hex");
		const actual = await derivePinKey(String(pin), Buffer.from(saltHex ?? "", "hex"));
		if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
			const count = (attempts?.count ?? 0) + 1;
			this.pinAttempts.set(attemptKey, count >= PIN_ATTEMPTS ? { count: 0, lockedUntil: Date.now() + PIN_LOCKOUT_MS } : { count, lockedUntil: 0 });
			throw new Forbidden("Incorrect PIN.");
		}
		this.pinAttempts.delete(attemptKey);
		const unlockedUntil = new Date(Date.now() + UNLOCK_MINUTES * 60_000);
		await this.dataSource.getRepository(UserSession).update({ id: policy.sessionId }, { accessUnlockedUntil: unlockedUntil });
		return { unlockedUntil };
	}

	async relock(policy: AccessPolicy): Promise<void> {
		if (policy.sessionId) await this.dataSource.getRepository(UserSession).update({ id: policy.sessionId }, { accessUnlockedUntil: null });
	}

	// --- administration -------------------------------------------------------------------------------------

	ratingLimits() {
		return RATING_LIMITS;
	}

	async getPolicy(userId: string): Promise<AccessPolicyDto> {
		await this.requireUser(userId);
		const row = await this.dataSource.getRepository(UserAccessPolicy).findOneBy({ userId });
		if (!row) return { ...EMPTY };
		return {
			libraryMode: row.libraryMode,
			libraryIds: row.libraryIds,
			maxAge: row.maxAge,
			blockUnrated: row.blockUnrated,
			allowedTags: row.allowedTags,
			blockedTags: row.blockedTags,
			schedule: row.schedule,
			requireRequestApproval: row.requireRequestApproval,
			hasPin: Boolean(row.pinHash),
		};
	}

	async savePolicy(userId: string, input: AccessPolicyInput): Promise<AccessPolicyDto> {
		await this.requireUser(userId);
		const repository = this.dataSource.getRepository(UserAccessPolicy);
		const row = (await repository.findOneBy({ userId })) ?? repository.create({ userId, libraryMode: "all", libraryIds: [], maxAge: null, blockUnrated: false, allowedTags: [], blockedTags: [], schedule: null, pinHash: null, requireRequestApproval: false });

		if (input.libraryMode !== undefined) {
			if (input.libraryMode !== "all" && input.libraryMode !== "selected") throw new BadRequest("libraryMode must be all or selected.");
			row.libraryMode = input.libraryMode;
		}
		if (input.libraryIds !== undefined) {
			const known = new Set((await this.dataSource.getRepository(MediaLibrary).find({ select: { id: true } })).map((library) => library.id));
			if (!Array.isArray(input.libraryIds)) throw new BadRequest("libraryIds must be a list.");
			row.libraryIds = [...new Set(input.libraryIds.map(String))].filter((id) => known.has(id));
		}
		if (input.pin !== undefined && input.pin !== null && typeof input.pin !== "string") throw new BadRequest("The PIN must be 6 digits.");
		if (input.maxAge !== undefined) {
			if (input.maxAge !== null && !RATING_LIMITS.some((limit) => limit.age === input.maxAge)) throw new BadRequest("maxAge isn't a supported rating limit.");
			row.maxAge = input.maxAge;
		}
		if (input.blockUnrated !== undefined) row.blockUnrated = input.blockUnrated === true;
		if (input.allowedTags !== undefined) row.allowedTags = this.cleanTags(input.allowedTags, "Allowed tags");
		if (input.blockedTags !== undefined) row.blockedTags = this.cleanTags(input.blockedTags, "Blocked tags");
		if (input.schedule !== undefined) row.schedule = input.schedule === null ? null : this.cleanSchedule(input.schedule);
		if (input.requireRequestApproval !== undefined) row.requireRequestApproval = input.requireRequestApproval === true;
		if (input.pin !== undefined) {
			if (input.pin === null) {
				row.pinHash = null;
			} else {
				if (!PIN_PATTERN.test(input.pin)) throw new BadRequest("The PIN must be 6 digits.");
				const salt = randomBytes(16);
				row.pinHash = `${salt.toString("hex")}:${(await derivePinKey(input.pin, salt)).toString("hex")}`;
			}
		}
		if (row.allowedTags.some((tag) => row.blockedTags.includes(tag))) throw new BadRequest("A tag can't be both allowed and blocked.");

		await repository.save(row);
		if (row.pinHash === null) {
			await this.dataSource.getRepository(UserSession).update({ userId }, { accessUnlockedUntil: null });
		}
		return this.getPolicy(userId);
	}

	/** A user's tags and genres, to suggest in the admin editor. */
	async knownTags(): Promise<string[]> {
		const rows: Array<{ tag: string }> = await this.dataSource.query(
			`SELECT DISTINCT lower(btrim(v)) AS tag FROM media_items, jsonb_array_elements_text((CASE WHEN jsonb_typeof(metadata -> 'genres') = 'array' THEN metadata -> 'genres' ELSE '[]'::jsonb END) || (CASE WHEN jsonb_typeof(metadata -> 'tags') = 'array' THEN metadata -> 'tags' ELSE '[]'::jsonb END)) v WHERE is_placeholder = false AND btrim(v) <> '' ORDER BY 1 LIMIT 500`,
		);
		return rows.map((row) => row.tag);
	}

	/** What a user can see under their policy, per library, with examples of what is blocked and why. */
	async preview(userId: string, draft?: AccessPolicyInput) {
		await this.requireUser(userId);
		const saved = await this.forUser(userId);
		const policy: AccessPolicy = draft
			? {
					...saved,
					libraryIds: draft.libraryMode === "selected" ? (Array.isArray(draft.libraryIds) ? draft.libraryIds.map(String) : []) : draft.libraryMode === "all" ? null : saved.libraryIds,
					maxAge: draft.maxAge === undefined ? saved.maxAge : draft.maxAge,
					blockUnrated: draft.blockUnrated ?? saved.blockUnrated,
					allowedTags: draft.allowedTags === undefined ? saved.allowedTags : this.cleanTags(draft.allowedTags, "Allowed tags"),
					blockedTags: draft.blockedTags === undefined ? saved.blockedTags : this.cleanTags(draft.blockedTags, "Blocked tags"),
					schedule: draft.schedule === undefined ? saved.schedule : draft.schedule === null ? null : this.cleanSchedule(draft.schedule),
				}
			: saved;
		const enforced: AccessPolicy = { ...policy, enforced: true, displayMode: "hidden" };
		const types = TOP_LEVEL_TYPES.map((type) => `'${type}'`).join(", ");
		const libraries = await this.dataSource.getRepository(MediaLibrary).find({ order: { name: "ASC" } });
		const perLibrary = await Promise.all(
			libraries.map(async (library) => {
				const base = () => this.dataSource.getRepository(MediaItem).createQueryBuilder("item").where("item.library_id = :libraryId", { libraryId: library.id }).andWhere("item.is_placeholder = false").andWhere(`item.type IN (${types})`);
				const total = await base().getCount();
				const visible = await this.restrict(base(), "item", enforced, { content: true }).getCount();
				return { id: library.id, name: library.name, type: library.type, total, visible, hidden: policy.libraryIds !== null && !policy.libraryIds.includes(library.id) };
			}),
		);
		const blockedQuery = this.dataSource.getRepository(MediaItem).createQueryBuilder("item").select(["item.id", "item.title", "item.type", "item.year"]).where("item.is_placeholder = false").andWhere(`item.type IN (${types})`);
		const blockedIds = (await blockedQuery.clone().orderBy("item.created_at", "DESC").limit(400).getMany()).map((item) => item.id);
		const reasons = await this.blockReasons(enforced, blockedIds);
		const blocked = (await this.dataSource.getRepository(MediaItem).findBy(blockedIds.filter((id) => reasons.has(id)).slice(0, 12).map((id) => ({ id })))).map((item) => ({ id: item.id, title: item.title, type: item.type, year: item.year, reason: reasons.get(item.id) as BlockReason }));
		const status = scheduleStatus(policy.schedule);
		return { libraries: perLibrary, blocked, schedule: { configured: Boolean(policy.schedule && policy.schedule.windows.length > 0), allowedNow: status.allowed, nextAllowedAt: status.nextAllowedAt } };
	}

	private async requireUser(userId: string): Promise<void> {
		if (!(await this.dataSource.getRepository(User).existsBy({ id: userId }))) throw new NotFound("User not found.");
	}

	private cleanTags(tags: unknown, label: string): string[] {
		if (!Array.isArray(tags) || tags.some((tag) => typeof tag !== "string")) throw new BadRequest(`${label} must be a list of text.`);
		const clean = [...new Set((tags as string[]).map((tag) => tag.trim().toLowerCase()).filter(Boolean))];
		if (clean.length > MAX_TAGS || clean.some((tag) => tag.length > 60)) throw new BadRequest(`${label} can hold up to ${MAX_TAGS} entries of 60 characters.`);
		return clean;
	}

	private cleanSchedule(schedule: AccessSchedule): AccessSchedule {
		const timezone = String(schedule.timezone ?? "").trim();
		try {
			new Intl.DateTimeFormat("en-US", { timeZone: timezone });
		} catch {
			throw new BadRequest("The schedule time zone isn't valid.");
		}
		if (!Array.isArray(schedule.windows) || schedule.windows.length > 21) throw new BadRequest("A schedule holds up to 21 windows.");
		const windows = schedule.windows.map((window) => {
			if (!window || !Array.isArray(window.days)) throw new BadRequest("Each schedule window needs days and HH:MM times.");
			const days = [...new Set(window.days)].filter((day) => Number.isInteger(day) && day >= 0 && day <= 6).sort();
			if (days.length === 0 || !TIME_PATTERN.test(window.from) || !TIME_PATTERN.test(window.to)) throw new BadRequest("Each schedule window needs days and HH:MM times.");
			return { days, from: window.from, to: window.to };
		});
		return { timezone, windows };
	}
}
