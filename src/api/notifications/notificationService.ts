import { Inject, Injectable, logger } from "@tsed/di";
import { BadRequest, NotFound } from "@tsed/exceptions";
import { randomUUID } from "node:crypto";
import { DataSource, In, IsNull, LessThan } from "typeorm";
import webpush from "web-push";
import { DefaultDataSource } from "../../datasources/defaultDataSource.datasource.js";
import { MediaItem } from "../../entities/mediaItem.entity.js";
import { Notification, type NotificationKind } from "../../entities/notification.entity.js";
import { PushKey } from "../../entities/pushKey.entity.js";
import { Setting } from "../../entities/setting.entity.js";
import { PushSubscription } from "../../entities/pushSubscription.entity.js";
import { User } from "../../entities/user.entity.js";

const NEW_MEDIA_TYPES = new Set(["movie", "series", "episode"]);
/** New titles are announced together once the indexer has been quiet this long, so a library scan is one message. */
const ANNOUNCE_QUIET_MS = 45_000;
const INBOX_LIMIT = 50;
const RETENTION_DAYS = 60;
const PUSH_TTL_SECONDS = 24 * 60 * 60;

export const NOTIFICATION_SETTING_KEYS = ["notifications_enabled", "notifications_new_media_enabled", "notifications_permission_prompt", "notifications_vapid_subject"];
export type PermissionPrompt = "button" | "load";

export interface NotificationConfig {
	enabled: boolean;
	newMediaEnabled: boolean;
	permissionPrompt: PermissionPrompt;
	vapidSubject: string;
}

/** A VAPID subject must be a mailto: address or an https URL. */
export function isValidVapidSubject(value: string): boolean {
	return /^mailto:[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) || /^https:\/\/[^\s]+$/.test(value);
}

export interface NotificationInput {
	title: string;
	body: string;
	url?: string | null;
	kind: NotificationKind;
}

export interface PushSubscriptionInput {
	endpoint: string;
	p256dh: string;
	auth: string;
}

/** Inbox messages plus Web Push delivery to the devices that subscribed. */
@Injectable()
export class NotificationService {

	private vapid: Promise<PushKey> | null = null;
	private pendingNew = new Set<string>();
	private announceTimer: ReturnType<typeof setTimeout> | undefined;

	constructor(@Inject(DefaultDataSource) private readonly dataSource: DataSource) {}

	async $onDestroy(): Promise<void> {
		clearTimeout(this.announceTimer);
	}

	async getConfig(): Promise<NotificationConfig> {
		const settings = await this.dataSource.getRepository(Setting).find();
		const values = new Map(settings.map((setting) => [setting.key, setting.value]));
		const subject = values.get("notifications_vapid_subject");
		return {
			enabled: values.get("notifications_enabled") !== false,
			newMediaEnabled: values.get("notifications_new_media_enabled") !== false,
			permissionPrompt: values.get("notifications_permission_prompt") === "load" ? "load" : "button",
			vapidSubject: (typeof subject === "string" && subject.trim() !== "" ? subject.trim() : process.env.VAPID_SUBJECT) || "mailto:notifications@flixer.invalid",
		};
	}

	async publicKey(): Promise<string> {
		return (await this.keys()).publicKey;
	}

	private keys(): Promise<PushKey> {
		this.vapid ??= (async () => {
			const repo = this.dataSource.getRepository(PushKey);
			const existing = await repo.findOneBy({ id: 1 });
			if (existing) {
				return existing;
			}
			const generated = webpush.generateVAPIDKeys();
			await repo.createQueryBuilder().insert().values({ id: 1, publicKey: generated.publicKey, privateKey: generated.privateKey }).orIgnore().execute();
			return (await repo.findOneByOrFail({ id: 1 }));
		})().catch((error) => {
			this.vapid = null;
			throw error;
		});
		return this.vapid;
	}

	async list(userId: string) {
		const repo = this.dataSource.getRepository(Notification);
		const [items, unread] = await Promise.all([
			repo.find({ where: { userId }, order: { createdAt: "DESC" }, take: INBOX_LIMIT }),
			repo.count({ where: { userId, readAt: IsNull() } }),
		]);
		return {
			unread,
			items: items.map((item) => ({ id: item.id, kind: item.kind, title: item.title, body: item.body, url: item.url, read: item.readAt !== null, createdAt: item.createdAt })),
		};
	}

	async markRead(userId: string, ids?: string[]): Promise<void> {
		const where = ids && ids.length > 0 ? { userId, id: In(ids), readAt: IsNull() } : { userId, readAt: IsNull() };
		await this.dataSource.getRepository(Notification).update(where, { readAt: new Date() });
	}

	async remove(userId: string, id: string): Promise<void> {
		const result = await this.dataSource.getRepository(Notification).delete({ id, userId });
		if (!result.affected) {
			throw new NotFound("Notification not found.");
		}
	}

	async subscribe(userId: string, input: PushSubscriptionInput): Promise<void> {
		let host: string;
		try {
			const url = new URL(input.endpoint);
			if (url.protocol !== "https:") {
				throw new Error("not https");
			}
			host = url.host;
		} catch {
			throw new BadRequest("The push endpoint must be an https URL.");
		}
		logger().info(`Push subscription registered for ${host}.`);
		// An endpoint identifies one browser profile; if it moved to another account, it follows the latest sign-in.
		await this.dataSource.getRepository(PushSubscription).upsert({ id: randomUUID(), userId, endpoint: input.endpoint, p256dh: input.p256dh, auth: input.auth }, ["endpoint"]);
	}

	async unsubscribe(userId: string, endpoint: string): Promise<void> {
		await this.dataSource.getRepository(PushSubscription).delete({ userId, endpoint });
	}

	async isSubscribed(userId: string, endpoint: string): Promise<boolean> {
		return this.dataSource.getRepository(PushSubscription).existsBy({ userId, endpoint });
	}

	/** Sends a message to the given users, or to every enabled user when none are given. */
	async send(input: NotificationInput, userIds?: string[]): Promise<{ recipients: number; pushed: number }> {
		if (!(await this.getConfig()).enabled) {
			throw new BadRequest("Notifications are turned off in the admin settings.");
		}
		const users = this.dataSource.getRepository(User);
		const recipients = (
			userIds && userIds.length > 0
				? await users.find({ where: { id: In(userIds), disabledAt: IsNull() }, select: { id: true } })
				: await users.find({ where: { disabledAt: IsNull() }, select: { id: true } })
		).map((user) => user.id);
		if (userIds && userIds.length > 0 && recipients.length === 0) {
			throw new BadRequest("None of the selected users can receive notifications.");
		}
		if (recipients.length === 0) {
			return { recipients: 0, pushed: 0 };
		}

		const title = input.title.slice(0, 120);
		const body = input.body.slice(0, 500);
		const rows = recipients.map((userId) => ({ id: randomUUID(), userId, kind: input.kind, title, body, url: input.url ?? null }));
		for (let start = 0; start < rows.length; start += 500) {
			await this.dataSource.getRepository(Notification).insert(rows.slice(start, start + 500));
		}
		await this.dataSource.getRepository(Notification).delete({ createdAt: LessThan(new Date(Date.now() - RETENTION_DAYS * 86_400_000)) }).catch(() => undefined);

		const pushed = await this.push(recipients, { title, body, url: input.url ?? "/" });
		return { recipients: recipients.length, pushed };
	}

	private async push(userIds: string[], payload: { title: string; body: string; url: string }): Promise<number> {
		const subscriptions = await this.dataSource.getRepository(PushSubscription).find({ where: { userId: In(userIds) } });
		if (subscriptions.length === 0) {
			return 0;
		}
		const keys = await this.keys();
		const config = await this.getConfig();
		const options = {
			vapidDetails: { subject: config.vapidSubject, publicKey: keys.publicKey, privateKey: keys.privateKey },
			TTL: PUSH_TTL_SECONDS,
		};
		const body = JSON.stringify(payload);
		const gone: string[] = [];
		let delivered = 0;
		await Promise.all(
			subscriptions.map(async (subscription) => {
				try {
					await webpush.sendNotification({ endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } }, body, options);
					delivered += 1;
				} catch (error) {
					const status = (error as { statusCode?: number }).statusCode;
					if (status === 404 || status === 410) {
						gone.push(subscription.id);
					} else {
						const detail = (error as { body?: string; message?: string }).body || (error as Error).message;
						logger().warn(`Push delivery failed${status ? ` (${status})` : ""} via ${new URL(subscription.endpoint).host}: ${detail}`);
					}
				}
			}),
		);
		if (gone.length > 0) {
			await this.dataSource.getRepository(PushSubscription).delete({ id: In(gone) });
		}
		return delivered;
	}

	/** Remembers a newly added item; the batch is announced after the indexer goes quiet. */
	announceNew(itemId: string, type: string): void {
		if (!NEW_MEDIA_TYPES.has(type)) {
			return;
		}
		this.pendingNew.add(itemId);
		clearTimeout(this.announceTimer);
		this.announceTimer = setTimeout(() => void this.flushAnnouncements(), ANNOUNCE_QUIET_MS);
		this.announceTimer.unref?.();
	}

	private async flushAnnouncements(): Promise<void> {
		const ids = [...this.pendingNew];
		this.pendingNew = new Set();
		if (ids.length === 0) {
			return;
		}
		try {
			const config = await this.getConfig();
			if (!config.enabled || !config.newMediaEnabled) {
				return;
			}
			const repo = this.dataSource.getRepository(MediaItem);
			const items = await repo.find({ where: { id: In(ids), isPlaceholder: false } });
			const seasonIds = [...new Set(items.filter((item) => item.type === "episode" && item.parentId).map((item) => item.parentId as string))];
			const seasons = seasonIds.length > 0 ? await repo.findBy({ id: In(seasonIds) }) : [];
			const seriesIdOfSeason = new Map(seasons.map((season) => [season.id, season.parentId]));
			const announcedSeries = new Set(items.filter((item) => item.type === "series").map((item) => item.id));

			const headlines: Array<{ label: string; url: string }> = [];
			const episodesBySeries = new Map<string, number>();
			for (const item of items) {
				if (item.type === "movie" || item.type === "series") {
					headlines.push({ label: item.title, url: `/media/${item.id}` });
				} else if (item.type === "episode") {
					const seriesId = item.parentId ? seriesIdOfSeason.get(item.parentId) : null;
					// Episodes of a show announced in the same batch are covered by the show itself.
					if (seriesId && !announcedSeries.has(seriesId)) {
						episodesBySeries.set(seriesId, (episodesBySeries.get(seriesId) ?? 0) + 1);
					}
				}
			}
			if (episodesBySeries.size > 0) {
				const series = await repo.findBy({ id: In([...episodesBySeries.keys()]) });
				for (const entry of series) {
					const count = episodesBySeries.get(entry.id) ?? 0;
					headlines.push({ label: count > 1 ? `${entry.title} (${count} new episodes)` : `${entry.title} (new episode)`, url: `/media/${entry.id}` });
				}
			}
			if (headlines.length === 0) {
				return;
			}
			const first = headlines[0];
			if (headlines.length === 1) {
				await this.send({ kind: "new_media", title: "New on Flixer", body: first.label, url: first.url });
				return;
			}
			const shown = headlines.slice(0, 3).map((entry) => entry.label).join(", ");
			const more = headlines.length > 3 ? ` and ${headlines.length - 3} more` : "";
			await this.send({ kind: "new_media", title: `${headlines.length} new titles on Flixer`, body: `${shown}${more}`, url: "/" });
		} catch (error) {
			logger().error("Failed to announce new media.", error);
		}
	}
}
