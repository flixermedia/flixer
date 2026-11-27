import { Inject, Injectable, logger } from "@tsed/di";
import { BadRequest, NotFound, TooManyRequests } from "@tsed/exceptions";
import { randomUUID } from "node:crypto";
import { DataSource, In, IsNull } from "typeorm";
import { DefaultDataSource } from "../../datasources/defaultDataSource.datasource.js";
import { ChatConversation } from "../../entities/chatConversation.entity.js";
import { IssueReport as IssueReportEntity, IssueReportUpdate as IssueReportUpdateEntity, type IssueReportAttachment } from "../../entities/issueReport.entity.js";
import { MediaItem } from "../../entities/mediaItem.entity.js";
import { Notification } from "../../entities/notification.entity.js";
import { Setting } from "../../entities/setting.entity.js";
import { User } from "../../entities/user.entity.js";
import { AuthService, type PublicUser } from "../auth/authService.js";
import { ChatService } from "../../chat/chatService.js";
import { NotificationService } from "../notifications/notificationService.js";

const ISSUE_REPORT_SETTINGS = {
	enabled: "issue_reports_enabled",
	categories: "issue_reports_categories",
	chatEnabled: "issue_reports_chat_enabled",
} as const;

const ISSUE_REPORT_STATUSES = ["open", "in_progress", "resolved", "closed"] as const;
type IssueReportStatus = (typeof ISSUE_REPORT_STATUSES)[number];

interface IssueReportUpdate {
	id: string;
	body: string;
	isInternal: boolean;
	attachments: IssueReportAttachment[];
	createdAt: string;
	author: { username: string; displayName: string } | null;
}

export interface IssueReport {
	id: string;
	title: string;
	category: string;
	description: string;
	status: IssueReportStatus;
	mediaItemId: string | null;
	mediaTitle: string | null;
	chatOpen: boolean;
	chatConversationId: string | null;
	attachments: IssueReportAttachment[];
	createdAt: string;
	updatedAt: string;
	resolvedAt: string | null;
	requester: { username: string; displayName: string };
	updates?: IssueReportUpdate[];
}

interface IssueReportRow {
	id: string;
	title: string;
	category: string;
	description: string;
	status: IssueReportStatus;
	media_item_id: string | null;
	media_title: string | null;
	chat_open: boolean;
	conversation_id: string | null;
	attachments?: IssueReportAttachment[];
	created_at: Date;
	updated_at: Date;
	resolved_at: Date | null;
	username: string;
	display_name: string | null;
}

interface UpdateRow {
	id: string;
	body: string;
	is_internal: boolean;
	attachments?: IssueReportAttachment[];
	created_at: Date;
	username: string | null;
	display_name: string | null;
}

const iso = (value: Date | null): string | null => (value ? value.toISOString() : null);

function reportOf(row: IssueReportRow): IssueReport {
	return {
		id: row.id,
		title: row.title,
		category: row.category,
		description: row.description,
		status: row.status,
		mediaItemId: row.media_item_id,
		mediaTitle: row.media_title,
		chatOpen: row.chat_open,
		chatConversationId: row.conversation_id,
		attachments: Array.isArray(row.attachments) ? row.attachments : [],
		createdAt: row.created_at.toISOString(),
		updatedAt: row.updated_at.toISOString(),
		resolvedAt: iso(row.resolved_at),
		requester: { username: row.username, displayName: row.display_name || row.username },
	};
}

@Injectable()
export class IssueReportsService {

	constructor(
		@Inject(DefaultDataSource) private readonly dataSource: DataSource,
		private readonly authService: AuthService,
		private readonly chat: ChatService,
		private readonly notifications?: NotificationService,
	) {}

	async configuration(): Promise<{ enabled: boolean; categories: string[]; chatEnabled: boolean }> {
		const rows = await this.dataSource.getRepository(Setting).find({ select: { key: true, value: true }, where: { key: In([ISSUE_REPORT_SETTINGS.enabled, ISSUE_REPORT_SETTINGS.categories, ISSUE_REPORT_SETTINGS.chatEnabled]) } });
		const values = new Map(rows.map(({ key, value }) => [key, value]));
		const categories = values.get(ISSUE_REPORT_SETTINGS.categories);
		const enabled = values.get(ISSUE_REPORT_SETTINGS.enabled);
		const chatEnabled = values.get(ISSUE_REPORT_SETTINGS.chatEnabled);
		if (typeof enabled !== "boolean" || typeof chatEnabled !== "boolean" || !Array.isArray(categories) || !categories.every((item) => typeof item === "string")) {
			throw new Error("Issue report settings are missing or invalid.");
		}
		return { enabled, categories, chatEnabled };
	}

	async create(
		authorization: string | undefined,
		request: {
			title: unknown;
			category: unknown;
			description: unknown;
			mediaItemId?: unknown;
			attachments?: unknown;
		},
	): Promise<IssueReport> {
		const user = await this.authService.getAuthenticatedUser(authorization);
		const config = await this.configuration();
		if (!config.enabled) {
			throw new BadRequest("Issue reports are currently disabled.");
		}
		const title = this.cleanText(request.title, 200, "Add a title for this issue.");
		const category = this.cleanText(request.category, 60, "Choose an issue category.");
		const description = this.cleanText(request.description, 5000, "Describe the issue.");
		if (!config.categories.includes(category)) {
			throw new BadRequest("Choose a valid issue category.");
		}
		const attachments = this.cleanAttachments(request.attachments);

		const mediaItemId = typeof request.mediaItemId === "string" && request.mediaItemId.trim() ? request.mediaItemId.trim() : null;
		let mediaTitle: string | null = null;
		if (mediaItemId) {
			if (!AuthService.isUuid(mediaItemId)) {
				throw new BadRequest("The linked media item id is invalid.");
			}
			const media = await this.dataSource.getRepository(MediaItem).findOne({ select: { title: true }, where: { id: mediaItemId } });
			if (!media) {
				throw new NotFound("The linked media item could not be found.");
			}
			mediaTitle = media.title;
		}

		// RAW SQL: use the database clock for the rolling 24-hour limit.
		const recent = await this.dataSource.getRepository(IssueReportEntity).createQueryBuilder("report").where("report.userId = :userId", { userId: user.id }).andWhere("report.createdAt > now() - interval '24 hours'").getCount();
		if (recent >= 5) {
			throw new TooManyRequests("You can submit up to five issue reports per day.");
		}

		const id = randomUUID();
		await this.dataSource.transaction(async (manager) => {
			await manager.getRepository(IssueReportEntity).insert({ id, userId: user.id, mediaItemId, mediaTitle, title, category, description, attachments });
			await manager.getRepository(IssueReportUpdateEntity).insert({ id: randomUUID(), reportId: id, body: "Issue report submitted." });
		});
		await this.notifyAdmins("New issue report", `${user.displayName || user.username} reported "${title}" (${category})`, "/admin?tab=issues&page=tickets", user.id);
		return this.userDetail(id, user);
	}

	async mine(authorization?: string): Promise<{ reports: IssueReport[] }> {
		const user = await this.authService.getAuthenticatedUser(authorization);
		const rows = await this.reportQuery().where("r.userId = :userId", { userId: user.id }).orderBy("r.updatedAt", "DESC").getRawMany<IssueReportRow>();
		return { reports: rows.map(reportOf) };
	}

	async userDetail(id: string, user?: PublicUser): Promise<IssueReport> {
		const actor = user ?? (await this.authService.getAuthenticatedUser());
		if (!AuthService.isUuid(id)) {
			throw new NotFound("Issue report not found.");
		}
		const row = await this.reportQuery().where("r.id = :id AND r.userId = :userId", { id, userId: actor.id }).getRawOne<IssueReportRow>();
		if (!row) {
			throw new NotFound("Issue report not found.");
		}
		const report = reportOf(row);
		report.updates = await this.updates(id, false);
		if (!report.chatOpen) {
			report.chatConversationId = null;
		}
		return report;
	}

	async adminList(authorization?: string): Promise<{ reports: IssueReport[] }> {
		await this.authService.requireAdmin(authorization);
		const rows = await this.reportQuery().orderBy("r.updatedAt", "DESC").getRawMany<IssueReportRow>();
		return { reports: rows.map(reportOf) };
	}

	async adminDetail(id: string, authorization?: string): Promise<IssueReport> {
		await this.authService.requireAdmin(authorization);
		const report = await this.find(id);
		report.updates = await this.updates(id, true);
		return report;
	}

	async deleteClosed(id: string, authorization?: string): Promise<void> {
		await this.authService.requireAdmin(authorization);
		if (!AuthService.isUuid(id)) {
			throw new NotFound("Issue report not found.");
		}
		await this.dataSource.transaction(async (manager) => {
			const report = await manager.findOne(IssueReportEntity, { select: { status: true, conversationId: true }, where: { id }, lock: { mode: "pessimistic_write" } });
			if (!report) {
				throw new NotFound("Issue report not found.");
			}
			if (report.status !== "closed") {
				throw new BadRequest("Only closed issue reports can be deleted.");
			}
			await manager.getRepository(IssueReportEntity).delete({ id });
			if (report.conversationId) {
				// RAW SQL: correlated NOT EXISTS protects a conversation still shared by other reports.
				const deletedConversation = await manager.createQueryBuilder().delete().from(ChatConversation).where('"id" = :conversationId AND NOT EXISTS (SELECT 1 FROM "issue_reports" WHERE "conversation_id" = :conversationId)', { conversationId: report.conversationId }).execute();
				if (deletedConversation.affected) {
					await manager.getRepository(Notification).delete({ kind: "message", url: `/chat/${report.conversationId}` });
				}
			}
		});
	}

	async setStatus(id: string, status: unknown, authorization?: string): Promise<IssueReport> {
		const { user } = await this.authService.requireAdminSession(authorization);
		if (typeof status !== "string" || !(ISSUE_REPORT_STATUSES as readonly string[]).includes(status)) {
			throw new BadRequest("Choose a valid issue status.");
		}
		const report = await this.find(id);
		if (report.status !== status) {
			await this.dataSource.transaction(async (manager) => {
				await manager.update(IssueReportEntity, { id }, { status, resolvedAt: status === "resolved" || status === "closed" ? () => "now()" : null, updatedAt: () => "now()" });
				await manager.getRepository(IssueReportUpdateEntity).insert({ id: randomUUID(), reportId: id, actorId: user.id, body: `Status changed to ${status.replace("_", " ")}.` });
			});
			await this.notifyRequester(id, "Issue report updated", `"${report.title}" is now ${status.replace("_", " ")}.`, `/issues/${id}`);
		}
		return this.adminDetail(id, authorization);
	}

	async addUpdate(id: string, body: unknown, internal: unknown, authorization?: string, rawAttachments?: unknown): Promise<IssueReport> {
		const { user } = await this.authService.requireAdminSession(authorization);
		const attachments = this.cleanAttachments(rawAttachments);
		const rawText = typeof body === "string" ? body.trim() : "";
		if ((!rawText && attachments.length === 0) || rawText.length > 2000) {
			throw new BadRequest("Write an update or attach an image first.");
		}
		const text = rawText;
		const isInternal = internal === true;
		const report = await this.find(id);
		await this.dataSource.getRepository(IssueReportUpdateEntity).insert({ id: randomUUID(), reportId: id, actorId: user.id, body: text, isInternal, attachments });
		await this.dataSource.getRepository(IssueReportEntity).update({ id }, { updatedAt: () => "now()" });
		if (!isInternal) {
			await this.notifyRequester(id, `Update on "${report.title}"`, text || "Attached an image.", `/issues/${id}`);
		}
		return this.adminDetail(id, authorization);
	}

	async addUserUpdate(id: string, body: unknown, rawAttachments: unknown, authorization?: string): Promise<IssueReport> {
		const user = await this.authService.getAuthenticatedUser(authorization);
		if (!AuthService.isUuid(id)) {
			throw new NotFound("Issue report not found.");
		}
		const row = await this.reportQuery().where("r.id = :id AND r.userId = :userId", { id, userId: user.id }).getRawOne<IssueReportRow>();
		if (!row) {
			throw new NotFound("Issue report not found.");
		}
		if (row.status === "closed") {
			throw new BadRequest("This issue report is closed.");
		}
		const attachments = this.cleanAttachments(rawAttachments);
		const rawText = typeof body === "string" ? body.trim() : "";
		if ((!rawText && attachments.length === 0) || rawText.length > 2000) {
			throw new BadRequest("Write a reply or attach an image first.");
		}
		await this.dataSource.getRepository(IssueReportUpdateEntity).insert({ id: randomUUID(), reportId: id, actorId: user.id, body: rawText, isInternal: false, attachments });
		await this.dataSource.getRepository(IssueReportEntity).update({ id }, { updatedAt: () => "now()" });
		await this.notifyAdmins(`Reply on "${row.title}"`, `${user.displayName || user.username}: ${rawText || "Attached an image."}`, "/admin?tab=issues&page=tickets", user.id);
		return this.userDetail(id, user);
	}

	async setChat(id: string, open: boolean, authorization?: string): Promise<IssueReport> {
		const { user } = await this.authService.requireAdminSession(authorization);
		if (typeof open !== "boolean") {
			throw new BadRequest("The chat open state must be a boolean.");
		}
		const config = await this.configuration();
		if (open && !config.chatEnabled) {
			throw new BadRequest("Live issue chats are disabled in settings.");
		}
		let report = await this.find(id);
		if (open && !report.chatConversationId) {
			const conversation = await this.chat.createSupportGroup(user.id, await this.requesterId(id), `Issue: ${report.title}`.slice(0, 60));
			await this.dataSource.getRepository(IssueReportEntity).update({ id, conversationId: IsNull() }, { conversationId: conversation.id });
			report = await this.find(id);
		}
		if (open && report.chatConversationId) {
			await this.chat.ensureSupportRequester(report.chatConversationId, await this.requesterId(id));
		}
		if (report.chatOpen === open) {
			return this.adminDetail(id, authorization);
		}
		await this.dataSource.transaction(async (manager) => {
			await manager.getRepository(IssueReportEntity).update({ id }, { chatOpen: open, updatedAt: () => "now()" });
			await manager.getRepository(IssueReportUpdateEntity).insert({ id: randomUUID(), reportId: id, actorId: user.id, body: open ? "Live chat is now open for this issue." : "Live chat has been closed for this issue." });
		});
		if (report.chatConversationId) {
			await this.chat.supportChatChanged(report.chatConversationId);
		}
		await this.notifyRequester(
			id,
			open ? "Live chat opened for your issue" : "Live chat closed for your issue",
			`"${report.title}"`,
			open && report.chatConversationId ? `/chat/${report.chatConversationId}` : `/issues/${id}`,
		);
		return this.adminDetail(id, authorization);
	}

	private async notifyAdmins(title: string, body: string, url: string, excludeUserId?: string): Promise<void> {
		if (!this.notifications) return;
		try {
			const admins = await this.dataSource.getRepository(User).find({ select: { id: true }, where: { role: "admin", disabledAt: IsNull() } });
			const ids = admins.map((a) => a.id).filter((id) => id !== excludeUserId);
			if (ids.length === 0) return;
			await this.notifications.send({ title, body: body.slice(0, 500), url, kind: "system" }, ids);
		} catch (error: unknown) {
			logger().warn("Could not notify admins about issue report.", error);
		}
	}

	private async notifyRequester(reportId: string, title: string, body: string, url: string): Promise<void> {
		if (!this.notifications) return;
		try {
			const userId = await this.requesterId(reportId);
			await this.notifications.send({ title, body: body.slice(0, 500), url, kind: "system" }, [userId]);
		} catch (error: unknown) {
			logger().warn("Could not notify requester about issue report update.", error);
		}
	}

	private async requesterId(id: string): Promise<string> {
		const report = await this.dataSource.getRepository(IssueReportEntity).findOne({ select: { userId: true }, where: { id } });
		if (!report) {
			throw new NotFound("Issue report not found.");
		}
		return report.userId;
	}

	private async find(id: string): Promise<IssueReport> {
		if (!AuthService.isUuid(id)) {
			throw new NotFound("Issue report not found.");
		}
		const row = await this.reportQuery().where("r.id = :id", { id }).getRawOne<IssueReportRow>();
		if (!row) {
			throw new NotFound("Issue report not found.");
		}
		return reportOf(row);
	}

	private async updates(id: string, includeInternal: boolean): Promise<IssueReportUpdate[]> {
		const query = this.dataSource.getRepository(IssueReportUpdateEntity).createQueryBuilder("update").leftJoin(User, "user", "user.id = update.actorId").select("update.id", "id").addSelect("update.body", "body").addSelect("update.isInternal", "is_internal").addSelect("update.attachments", "attachments").addSelect("update.createdAt", "created_at").addSelect("user.username", "username").addSelect("user.displayName", "display_name").where("update.reportId = :id", { id });
		if (!includeInternal) query.andWhere("update.isInternal = false");
		const rows = await query.orderBy("update.createdAt", "ASC").getRawMany<UpdateRow>();
		return rows.map((row) => ({
			id: row.id,
			body: row.body,
			isInternal: row.is_internal,
			attachments: Array.isArray(row.attachments) ? row.attachments : [],
			createdAt: row.created_at.toISOString(),
			author: row.username ? { username: row.username, displayName: row.display_name || row.username } : null,
		}));
	}

	private reportQuery() {
		return this.dataSource.getRepository(IssueReportEntity).createQueryBuilder("r").innerJoin(User, "u", "u.id = r.userId").leftJoin(MediaItem, "mi", "mi.id = r.mediaItemId").select("r.id", "id").addSelect("r.title", "title").addSelect("r.category", "category").addSelect("r.description", "description").addSelect("r.status", "status").addSelect("r.mediaItemId", "media_item_id").addSelect("COALESCE(r.mediaTitle, mi.title)", "media_title").addSelect("r.chatOpen", "chat_open").addSelect("r.conversationId", "conversation_id").addSelect("r.attachments", "attachments").addSelect("r.createdAt", "created_at").addSelect("r.updatedAt", "updated_at").addSelect("r.resolvedAt", "resolved_at").addSelect("u.username", "username").addSelect("u.displayName", "display_name");
	}

	private cleanAttachments(raw: unknown): IssueReportAttachment[] {
		if (!Array.isArray(raw) || raw.length === 0) return [];
		if (raw.length > 4) {
			throw new BadRequest("You can attach up to 4 images per message.");
		}
		const cleaned: IssueReportAttachment[] = [];
		for (const item of raw) {
			if (!item || typeof item !== "object") continue;
			const record = item as { name?: unknown; dataUrl?: unknown };
			const dataUrl = typeof record.dataUrl === "string" ? record.dataUrl.trim() : "";
			const match = /^data:(image\/(?:png|jpeg|webp|gif));base64,[A-Za-z0-9+/=]+$/.exec(dataUrl);
			if (!match) {
				throw new BadRequest("Attachments must be valid PNG, JPEG, WebP, or GIF images.");
			}
			if (dataUrl.length > 3_500_000) {
				throw new BadRequest("Each attached image must be under 2.5 MB.");
			}
			const rawName = typeof record.name === "string" && record.name.trim() ? record.name.trim().replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80) : "image.png";
			cleaned.push({ id: randomUUID(), name: rawName, dataUrl, contentType: match[1] });
		}
		return cleaned;
	}

	private cleanText(value: unknown, maxLength: number, message: string): string {
		const text = typeof value === "string" ? value.trim() : "";
		if (!text || text.length > maxLength) {
			throw new BadRequest(message);
		}
		return text;
	}
}
