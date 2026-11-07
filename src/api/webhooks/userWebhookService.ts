import { Inject, Injectable, logger } from "@tsed/di";
import { BadRequest, Forbidden, NotFound } from "@tsed/exceptions";
import { randomUUID } from "node:crypto";
import { DataSource } from "typeorm";
import { RE2JS } from "re2js";
import { DefaultDataSource } from "../../datasources/defaultDataSource.datasource.js";
import { AuthService } from "../auth/authService.js";
import { MediaAccessService } from "../access/mediaAccessService.js";

type Audience = "admins" | "everyone";
type Actor = { id: string; role: string };
type Config = { enabled: boolean; audience: Audience; allowedUrls: string[] };
type Hook = { id: string; name: string; url: string; enabled: boolean };
type ConfigRow = { enabled: boolean; audience: Audience; allowed_urls: string[] };
const EVENTS = ["playback.started", "playback.paused", "playback.resumed", "playback.stopped"] as const;
const MAX_PENDING_DELIVERIES = 128;
const compiledPatterns = new Map<string, RE2JS>();

function compilePattern(pattern: string): RE2JS {
	const cached = compiledPatterns.get(pattern);
	if (cached) return cached;
	const compiled = RE2JS.compile(pattern);
	if (compiledPatterns.size >= 100) {
		const oldest = compiledPatterns.keys().next().value;
		if (oldest !== undefined) compiledPatterns.delete(oldest);
	}
	compiledPatterns.set(pattern, compiled);
	return compiled;
}

function object(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new BadRequest("Expected a JSON object.");
	return value as Record<string, unknown>;
}

/** Canonicalizes a destination without allowing credentials, non-HTTP protocols or fragments. */
export function webhookUrl(value: unknown): string {
	if (typeof value !== "string" || value.length > 2048 || value.trim() !== value) throw new BadRequest("Invalid webhook URL.");
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new BadRequest("Invalid webhook URL.");
	}
	if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.hash) {
		throw new BadRequest("Webhook URLs must use HTTP or HTTPS without credentials or fragments.");
	}
	return url.href;
}

function parseConfig(raw: unknown): Config {
	const value = object(raw);
	if (typeof value.enabled !== "boolean" || (value.audience !== "admins" && value.audience !== "everyone") ||
		!Array.isArray(value.allowedUrls) || value.allowedUrls.length > 100) {
		throw new BadRequest("Invalid webhook configuration.");
	}
	const allowedUrls = value.allowedUrls.map((rule: unknown) => {
		if (typeof rule === "string" && rule.startsWith("regex:")) {
			const pattern = rule.slice(6);
			if (!pattern || pattern.length > 512 || /[\r\n]/.test(pattern)) throw new BadRequest("Invalid webhook URL regex.");
			try {
				compilePattern(pattern);
			} catch {
				throw new BadRequest("Invalid or unsupported webhook URL regex.");
			}
			return rule;
		}
		return webhookUrl(rule);
	});
	return { enabled: value.enabled, audience: value.audience, allowedUrls: [...new Set(allowedUrls)] };
}

function allowsUrl(config: Config, url: string): boolean {
	return config.allowedUrls.some((rule) => rule.startsWith("regex:")
		? compilePattern(rule.slice(6)).matches(url)
		: rule === url);
}

function permitted(config: Config, actor: Actor): boolean {
	return config.enabled && (config.audience === "everyone" || actor.role === "admin");
}

/** Manages user-owned webhooks and delivers playback events to approved destinations. */
@Injectable()
export class UserWebhookService {
	private pendingDeliveries = 0;
	private readonly deliveryQueues = new Map<string, Promise<void>>();

	constructor(@Inject(DefaultDataSource) private readonly dataSource: DataSource, private readonly access: MediaAccessService) {}

	async config(): Promise<Config> {
		const rows = await this.dataSource.query("SELECT enabled, audience, allowed_urls FROM user_webhook_config WHERE id = 1") as ConfigRow[];
		if (!rows[0]) throw new Error("User webhook configuration is missing.");
		return parseConfig({ enabled: rows[0].enabled, audience: rows[0].audience, allowedUrls: rows[0].allowed_urls });
	}

	async updateConfig(raw: unknown): Promise<Config> {
		const config = parseConfig(raw);
		await this.dataSource.query("UPDATE user_webhook_config SET enabled = $1, audience = $2, allowed_urls = $3::jsonb WHERE id = 1", [config.enabled, config.audience, JSON.stringify(config.allowedUrls)]);
		return config;
	}

	async list(actor: Actor) {
		const config = await this.config();
		const hooks = await this.dataSource.query("SELECT id, name, url, enabled FROM user_webhooks WHERE user_id = $1 ORDER BY created_at", [actor.id]) as Hook[];
		return { available: permitted(config, actor), hooks };
	}

	async save(actor: Actor, raw: unknown, id?: string): Promise<Hook> {
		const config = await this.config();
		if (!permitted(config, actor)) throw new Forbidden("Webhooks are not enabled for this account.");
		const value = object(raw);
		if (typeof value.name !== "string" || !value.name.trim() || value.name.trim().length > 100 || typeof value.enabled !== "boolean") {
			throw new BadRequest("Invalid webhook name or status.");
		}
		const url = webhookUrl(value.url);
		if (!allowsUrl(config, url)) throw new BadRequest("This webhook URL has not been approved by an administrator.");
		if (id && !AuthService.isUuid(id)) throw new NotFound("Webhook not found.");
		const rows = id
			? await this.dataSource.query("WITH updated AS (UPDATE user_webhooks SET name = $3, url = $4, enabled = $5 WHERE id = $1 AND user_id = $2 RETURNING id, name, url, enabled) SELECT * FROM updated", [id, actor.id, value.name.trim(), url, value.enabled])
			: await this.dataSource.transaction(async (manager) => {
				await manager.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`user-webhooks:${actor.id}`]);
				return manager.query("INSERT INTO user_webhooks (id, user_id, name, url, enabled) SELECT $1, $2, $3, $4, $5 WHERE (SELECT count(*) FROM user_webhooks WHERE user_id = $2) < 10 RETURNING id, name, url, enabled", [randomUUID(), actor.id, value.name.trim(), url, value.enabled]) as Promise<Hook[]>;
			});
		if (!rows.length) {
			if (id) throw new NotFound("Webhook not found.");
			throw new BadRequest("You can create at most 10 webhooks.");
		}
		return rows[0] as Hook;
	}

	async remove(actor: Actor, id: string): Promise<void> {
		if (!AuthService.isUuid(id)) throw new NotFound("Webhook not found.");
		const rows = await this.dataSource.query("WITH deleted AS (DELETE FROM user_webhooks WHERE id = $1 AND user_id = $2 RETURNING id) SELECT id FROM deleted", [id, actor.id]) as Array<{ id: string }>;
		if (!rows.length) throw new NotFound("Webhook not found.");
	}

	async report(actor: Actor, raw: unknown, authorization?: string): Promise<void> {
		const config = await this.config();
		if (!permitted(config, actor)) return;
		const hooks = await this.dataSource.query("SELECT id, name, url, enabled FROM user_webhooks WHERE user_id = $1 AND enabled = true", [actor.id]) as Hook[];
		if (!hooks.some((hook) => allowsUrl(config, hook.url))) return;
		const value = object(raw);
		if (typeof value.event !== "string" || !(EVENTS as readonly string[]).includes(value.event) ||
			typeof value.position !== "number" || !Number.isFinite(value.position) || value.position < 0 || value.position > 604800) {
			throw new BadRequest("Invalid playback event.");
		}
		const target = object(value.target);
		let media: Record<string, unknown>;
		if (target.kind === "video" || target.kind === "music") {
			if (typeof target.itemId !== "string" || !AuthService.isUuid(target.itemId)) throw new BadRequest("Invalid media item.");
			const itemId = target.itemId.toLowerCase();
			const policy = await this.access.resolve(authorization);
			if (!(await this.access.visibleIds(policy, [itemId])).has(itemId)) throw new NotFound("Media item not found.");
			const rows = await this.dataSource.query("SELECT id, title, type FROM media_items WHERE id = $1 AND type = ANY($2::text[])", [itemId, target.kind === "music" ? ["track"] : ["movie", "episode", "video"]]) as Array<{ id: string; title: string; type: string }>;
			if (!rows[0]) throw new NotFound("Media item not found.");
			media = { kind: target.kind, ...rows[0] };
		} else if (target.kind === "live" && typeof target.channelId === "string" && target.channelId.length > 0 && target.channelId.length <= 256 && typeof target.channelName === "string" && target.channelName.trim().length > 0 && target.channelName.length <= 256) {
			media = { kind: "live", id: target.channelId, title: target.channelName };
		} else throw new BadRequest("Invalid playback target.");
		const payload = JSON.stringify({ id: randomUUID(), event: value.event, occurredAt: new Date().toISOString(), userId: actor.id, media, positionSeconds: value.position });
		for (const hook of hooks) {
			if (!allowsUrl(config, hook.url)) continue;
			if (this.pendingDeliveries >= MAX_PENDING_DELIVERIES) {
				logger().warn("[webhooks] Delivery skipped: queue limit reached.");
				continue;
			}
			this.pendingDeliveries++;
			const previous = this.deliveryQueues.get(hook.id) ?? Promise.resolve();
			const next = previous.then(() => this.deliver(hook, payload)).finally(() => {
				this.pendingDeliveries--;
				if (this.deliveryQueues.get(hook.id) === next) this.deliveryQueues.delete(hook.id);
			});
			this.deliveryQueues.set(hook.id, next);
		}
	}

	private async deliver(hook: Hook, payload: string): Promise<void> {
		try {
			const config = await this.config();
			if (!config.enabled || !allowsUrl(config, hook.url)) return;
			const rows = await this.dataSource.query("SELECT h.id FROM user_webhooks h JOIN users u ON u.id = h.user_id WHERE h.id = $1 AND h.enabled = true AND h.url = $2 AND u.disabled_at IS NULL AND ($3 = 'everyone' OR u.role = 'admin')", [hook.id, hook.url, config.audience]) as Array<{ id: string }>;
			if (!rows.length) return;
			const response = await fetch(hook.url, {
				method: "POST",
				headers: { "content-type": "application/json", "user-agent": "Flixer-Webhook/1" },
				body: payload,
				redirect: "error",
				signal: AbortSignal.timeout(5000),
			});
			await response.body?.cancel();
			if (!response.ok) logger().warn(`[webhooks] Delivery ${hook.id} failed with HTTP ${response.status}.`);
		} catch (error) {
			logger().warn(`[webhooks] Delivery ${hook.id} failed: ${error instanceof Error ? error.name : "unknown error"}.`);
		}
	}
}
