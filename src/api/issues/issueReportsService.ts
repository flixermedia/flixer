import { Inject, Injectable } from "@tsed/di";
import { BadRequest, NotFound, TooManyRequests } from "@tsed/exceptions";
import { randomUUID } from "node:crypto";
import { DataSource, In, IsNull } from "typeorm";
import { DefaultDataSource } from "../../datasources/defaultDataSource.datasource.js";
import { ChatConversation } from "../../entities/chatConversation.entity.js";
import { IssueReport as IssueReportEntity, IssueReportUpdate as IssueReportUpdateEntity } from "../../entities/issueReport.entity.js";
import { MediaItem } from "../../entities/mediaItem.entity.js";
import { Notification } from "../../entities/notification.entity.js";
import { Setting } from "../../entities/setting.entity.js";
import { User } from "../../entities/user.entity.js";
import { AuthService, type PublicUser } from "../auth/authService.js";
import { ChatService } from "../../chat/chatService.js";

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
			await manager.getRepository(IssueReportEntity).insert({ id, userId: user.id, mediaItemId, mediaTitle, title, category, description });
			await manager.getRepository(IssueReportUpdateEntity).insert({ id: randomUUID(), reportId: id, body: "Issue report submitted." });
		});
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
		}
		return this.adminDetail(id, authorization);
	}

	async addUpdate(id: string, body: unknown, internal: unknown, authorization?: string): Promise<IssueReport> {
		const { user } = await this.authService.requireAdminSession(authorization);
		const text = this.cleanText(body, 2000, "Write an update first.");
		const isInternal = internal === true;
		await this.find(id);
		await this.dataSource.getRepository(IssueReportUpdateEntity).insert({ id: randomUUID(), reportId: id, actorId: user.id, body: text, isInternal });
		await this.dataSource.getRepository(IssueReportEntity).update({ id }, { updatedAt: () => "now()" });
		return this.adminDetail(id, authorization);
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
		return this.adminDetail(id, authorization);
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
		const query = this.dataSource.getRepository(IssueReportUpdateEntity).createQueryBuilder("update").leftJoin(User, "user", "user.id = update.actorId").select("update.id", "id").addSelect("update.body", "body").addSelect("update.isInternal", "is_internal").addSelect("update.createdAt", "created_at").addSelect("user.username", "username").addSelect("user.displayName", "display_name").where("update.reportId = :id", { id });
		if (!includeInternal) query.andWhere("update.isInternal = false");
		const rows = await query.orderBy("update.createdAt", "ASC").getRawMany<UpdateRow>();
		return rows.map((row) => ({
			id: row.id,
			body: row.body,
			isInternal: row.is_internal,
			createdAt: row.created_at.toISOString(),
			author: row.username ? { username: row.username, displayName: row.display_name || row.username } : null,
		}));
	}

	private reportQuery() {
		return this.dataSource.getRepository(IssueReportEntity).createQueryBuilder("r").innerJoin(User, "u", "u.id = r.userId").leftJoin(MediaItem, "mi", "mi.id = r.mediaItemId").select("r.id", "id").addSelect("r.title", "title").addSelect("r.category", "category").addSelect("r.description", "description").addSelect("r.status", "status").addSelect("r.mediaItemId", "media_item_id").addSelect("COALESCE(r.mediaTitle, mi.title)", "media_title").addSelect("r.chatOpen", "chat_open").addSelect("r.conversationId", "conversation_id").addSelect("r.createdAt", "created_at").addSelect("r.updatedAt", "updated_at").addSelect("r.resolvedAt", "resolved_at").addSelect("u.username", "username").addSelect("u.displayName", "display_name");
	}

	private cleanText(value: unknown, maxLength: number, message: string): string {
		const text = typeof value === "string" ? value.trim() : "";
		if (!text || text.length > maxLength) {
			throw new BadRequest(message);
		}
		return text;
	}
}
