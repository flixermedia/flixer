import { Inject, Injectable } from "@tsed/di";
import { BadRequest, NotFound, TooManyRequests } from "@tsed/exceptions";
import { randomUUID } from "node:crypto";
import { DataSource } from "typeorm";
import { DefaultDataSource } from "../../datasources/defaultDataSource.datasource.js";
import { AuthService, type PublicUser } from "../auth/authService.js";
import { ChatService } from "../../chat/chatService.js";

export const ISSUE_REPORT_SETTINGS = {
	enabled: "issue_reports_enabled",
	categories: "issue_reports_categories",
	chatEnabled: "issue_reports_chat_enabled",
} as const;

export const ISSUE_REPORT_STATUSES = ["open", "in_progress", "resolved", "closed"] as const;
export type IssueReportStatus = (typeof ISSUE_REPORT_STATUSES)[number];

export interface IssueReportUpdate {
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

const REPORT_SELECT = `SELECT r.id, r.title, r.category, r.description, r.status, r.media_item_id, COALESCE(r.media_title, mi.title) AS media_title,
	r.chat_open, r.conversation_id, r.created_at, r.updated_at, r.resolved_at,
	u.username, u.display_name
	FROM issue_reports r JOIN users u ON u.id = r.user_id LEFT JOIN media_items mi ON mi.id = r.media_item_id`;

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
		const rows = (await this.dataSource.query(`SELECT key, value FROM settings WHERE key = ANY($1::text[])`, [[ISSUE_REPORT_SETTINGS.enabled, ISSUE_REPORT_SETTINGS.categories, ISSUE_REPORT_SETTINGS.chatEnabled]])) as Array<{ key: string; value: unknown }>;
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
			const [media] = (await this.dataSource.query(`SELECT title FROM media_items WHERE id = $1`, [mediaItemId])) as Array<{ title: string }>;
			if (!media) {
				throw new NotFound("The linked media item could not be found.");
			}
			mediaTitle = media.title;
		}

		const recent = (await this.dataSource.query(`SELECT count(*)::int AS count FROM issue_reports WHERE user_id = $1 AND created_at > now() - interval '24 hours'`, [user.id])) as Array<{ count: number }>;
		if ((recent[0]?.count ?? 0) >= 5) {
			throw new TooManyRequests("You can submit up to five issue reports per day.");
		}

		const id = randomUUID();
		await this.dataSource.transaction(async (manager) => {
			await manager.query(
				`INSERT INTO issue_reports (id, user_id, media_item_id, media_title, title, category, description)
				VALUES ($1, $2, $3, $4, $5, $6, $7)`,
				[id, user.id, mediaItemId, mediaTitle, title, category, description],
			);
			await manager.query(`INSERT INTO issue_report_updates (id, report_id, body) VALUES ($1, $2, 'Issue report submitted.')`, [randomUUID(), id]);
		});
		return this.userDetail(id, user);
	}

	async mine(authorization?: string): Promise<{ reports: IssueReport[] }> {
		const user = await this.authService.getAuthenticatedUser(authorization);
		const rows = (await this.dataSource.query(`${REPORT_SELECT} WHERE r.user_id = $1 ORDER BY r.updated_at DESC`, [user.id])) as IssueReportRow[];
		return { reports: rows.map(reportOf) };
	}

	async userDetail(id: string, user?: PublicUser): Promise<IssueReport> {
		const actor = user ?? (await this.authService.getAuthenticatedUser());
		if (!AuthService.isUuid(id)) {
			throw new NotFound("Issue report not found.");
		}
		const rows = (await this.dataSource.query(`${REPORT_SELECT} WHERE r.id = $1 AND r.user_id = $2`, [id, actor.id])) as IssueReportRow[];
		if (!rows[0]) {
			throw new NotFound("Issue report not found.");
		}
		const report = reportOf(rows[0]);
		report.updates = await this.updates(id, false);
		if (!report.chatOpen) {
			report.chatConversationId = null;
		}
		return report;
	}

	async adminList(authorization?: string): Promise<{ reports: IssueReport[] }> {
		await this.authService.requireAdmin(authorization);
		const rows = (await this.dataSource.query(`${REPORT_SELECT} ORDER BY r.updated_at DESC`)) as IssueReportRow[];
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
			const rows = (await manager.query(`SELECT status, conversation_id FROM issue_reports WHERE id = $1 FOR UPDATE`, [id])) as Array<{ status: IssueReportStatus; conversation_id: string | null }>;
			const report = rows[0];
			if (!report) {
				throw new NotFound("Issue report not found.");
			}
			if (report.status !== "closed") {
				throw new BadRequest("Only closed issue reports can be deleted.");
			}
			await manager.query(`DELETE FROM issue_reports WHERE id = $1`, [id]);
			if (report.conversation_id) {
				const deletedConversations = (await manager.query(
					`DELETE FROM chat_conversations WHERE id = $1 AND NOT EXISTS (
						SELECT 1 FROM issue_reports WHERE conversation_id = $1
					) RETURNING id`,
					[report.conversation_id],
				)) as Array<{ id: string }>;
				if (deletedConversations.length > 0) {
					await manager.query(`DELETE FROM notifications WHERE kind = 'message' AND url = $1`, [`/chat/${report.conversation_id}`]);
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
				await manager.query(`UPDATE issue_reports SET status = $2, resolved_at = CASE WHEN $3 THEN now() ELSE NULL END, updated_at = now() WHERE id = $1`, [id, status, status === "resolved" || status === "closed"]);
				await manager.query(`INSERT INTO issue_report_updates (id, report_id, actor_id, body) VALUES ($1, $2, $3, $4)`, [randomUUID(), id, user.id, `Status changed to ${status.replace("_", " ")}.`]);
			});
		}
		return this.adminDetail(id, authorization);
	}

	async addUpdate(id: string, body: unknown, internal: unknown, authorization?: string): Promise<IssueReport> {
		const { user } = await this.authService.requireAdminSession(authorization);
		const text = this.cleanText(body, 2000, "Write an update first.");
		const isInternal = internal === true;
		await this.find(id);
		await this.dataSource.query(`INSERT INTO issue_report_updates (id, report_id, actor_id, body, is_internal) VALUES ($1, $2, $3, $4, $5)`, [randomUUID(), id, user.id, text, isInternal]);
		await this.dataSource.query(`UPDATE issue_reports SET updated_at = now() WHERE id = $1`, [id]);
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
			await this.dataSource.query(`UPDATE issue_reports SET conversation_id = $2 WHERE id = $1 AND conversation_id IS NULL`, [id, conversation.id]);
			report = await this.find(id);
		}
		if (open && report.chatConversationId) {
			await this.chat.ensureSupportRequester(report.chatConversationId, await this.requesterId(id));
		}
		if (report.chatOpen === open) {
			return this.adminDetail(id, authorization);
		}
		await this.dataSource.transaction(async (manager) => {
			await manager.query(`UPDATE issue_reports SET chat_open = $2, updated_at = now() WHERE id = $1`, [id, open]);
			await manager.query(`INSERT INTO issue_report_updates (id, report_id, actor_id, body) VALUES ($1, $2, $3, $4)`, [randomUUID(), id, user.id, open ? "Live chat is now open for this issue." : "Live chat has been closed for this issue."]);
		});
		if (report.chatConversationId) {
			await this.chat.supportChatChanged(report.chatConversationId);
		}
		return this.adminDetail(id, authorization);
	}

	private async requesterId(id: string): Promise<string> {
		const rows = (await this.dataSource.query(`SELECT user_id FROM issue_reports WHERE id = $1`, [id])) as Array<{ user_id: string }>;
		if (!rows[0]) {
			throw new NotFound("Issue report not found.");
		}
		return rows[0].user_id;
	}

	private async find(id: string): Promise<IssueReport> {
		if (!AuthService.isUuid(id)) {
			throw new NotFound("Issue report not found.");
		}
		const rows = (await this.dataSource.query(`${REPORT_SELECT} WHERE r.id = $1`, [id])) as IssueReportRow[];
		if (!rows[0]) {
			throw new NotFound("Issue report not found.");
		}
		return reportOf(rows[0]);
	}

	private async updates(id: string, includeInternal: boolean): Promise<IssueReportUpdate[]> {
		const rows = (await this.dataSource.query(
			`SELECT i.id, i.body, i.is_internal, i.created_at, u.username, u.display_name
			FROM issue_report_updates i LEFT JOIN users u ON u.id = i.actor_id
			WHERE i.report_id = $1 AND ($2 = true OR i.is_internal = false) ORDER BY i.created_at ASC`,
			[id, includeInternal],
		)) as UpdateRow[];
		return rows.map((row) => ({
			id: row.id,
			body: row.body,
			isInternal: row.is_internal,
			createdAt: row.created_at.toISOString(),
			author: row.username ? { username: row.username, displayName: row.display_name || row.username } : null,
		}));
	}

	private cleanText(value: unknown, maxLength: number, message: string): string {
		const text = typeof value === "string" ? value.trim() : "";
		if (!text || text.length > maxLength) {
			throw new BadRequest(message);
		}
		return text;
	}
}
