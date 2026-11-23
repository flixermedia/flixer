import { describe, expect, it, vi } from "vitest";
import type { DataSource } from "typeorm";
import type { AuthService, PublicUser } from "../auth/authService.js";
import type { ChatService } from "../../chat/chatService.js";
import { IssueReport as IssueReportEntity, IssueReportUpdate as IssueReportUpdateEntity } from "../../entities/issueReport.entity.js";
import { IssueReportsService } from "./issueReportsService.js";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const REPORT_ID = "22222222-2222-4222-8222-222222222222";
const now = new Date("2026-01-01T00:00:00.000Z");
const user = { id: USER_ID, username: "viewer", displayName: "Viewer", role: "user" } as PublicUser;

function createService(
	config: { enabled: boolean; chatEnabled: boolean; categories: string[] } = {
		enabled: true,
		chatEnabled: true,
		categories: ["Playback", "Other"],
	},
	reportStatus: string = "open",
	conversationId: string | null = null,
	chatOpen = false,
) {

	const row = {
		id: REPORT_ID,
		title: "Playback issue",
		category: "Playback",
		description: "The video stops.",
		status: reportStatus,
		media_item_id: null,
		media_title: null,
		chat_open: chatOpen,
		conversation_id: conversationId,
		created_at: now,
		updated_at: now,
		resolved_at: null,
		username: user.username,
		display_name: user.displayName,
	};
	const query = vi.fn(async (sql: string, params?: unknown[]): Promise<unknown[]> => {
		if (sql.includes("SELECT count(*)::int AS count")) return [{ count: 0 }];
		if (sql.includes("FROM issue_reports r")) return [row];
		if (sql.includes("FROM issue_report_updates")) {
			return [{ id: "update-id", body: "Issue report submitted.", is_internal: false, created_at: now, username: null, display_name: null }];
		}
		return [];
	});
	const notificationDelete = vi.fn(async () => ({ affected: 1 }));
	const reportDelete = vi.fn(async () => ({ affected: 1 }));
	const reportInsert = vi.fn(async () => ({}));
	const reportUpdate = vi.fn(async () => ({ affected: 1 }));
	const updateInsert = vi.fn(async () => ({}));
	const reportBuilder = { innerJoin: vi.fn(), leftJoin: vi.fn(), select: vi.fn(), addSelect: vi.fn(), where: vi.fn(), orderBy: vi.fn(), getRawMany: vi.fn(async () => [row]), getRawOne: vi.fn(async () => row) };
	const updateBuilder = { leftJoin: vi.fn(), select: vi.fn(), addSelect: vi.fn(), where: vi.fn(), andWhere: vi.fn(), orderBy: vi.fn(), getRawMany: vi.fn(async () => [{ id: "update-id", body: "Issue report submitted.", is_internal: false, created_at: now, username: null, display_name: null }]) };
	for (const name of ["innerJoin", "leftJoin", "select", "addSelect", "where", "orderBy"] as const) reportBuilder[name].mockReturnValue(reportBuilder);
	for (const name of ["leftJoin", "select", "addSelect", "where", "andWhere", "orderBy"] as const) updateBuilder[name].mockReturnValue(updateBuilder);
	let deleteAffected = 1;
	const deleteBuilder = { delete: vi.fn(), from: vi.fn(), where: vi.fn(), execute: vi.fn(async () => ({ affected: deleteAffected })) };
	for (const name of ["delete", "from", "where"] as const) deleteBuilder[name].mockReturnValue(deleteBuilder);
	const manager = {
		getRepository: vi.fn((entity: { name: string }) => {
			if (entity.name === "IssueReport") return { insert: reportInsert, delete: reportDelete, update: reportUpdate };
			if (entity.name === "IssueReportUpdate") return { insert: updateInsert };
			return { delete: notificationDelete };
		}),
		findOne: vi.fn(async (entity: unknown) => (entity === IssueReportEntity ? { status: reportStatus, conversationId: conversationId ?? "33333333-3333-4333-8333-333333333333" } : null)),
		update: reportUpdate,
		createQueryBuilder: vi.fn(() => deleteBuilder),
	};
	const transaction = vi.fn(async (work: (transactionManager: typeof manager) => Promise<unknown>) => work(manager));
	const settings = [
		{ key: "issue_reports_enabled", value: config.enabled },
		{ key: "issue_reports_categories", value: config.categories },
		{ key: "issue_reports_chat_enabled", value: config.chatEnabled },
	];
	const reportCount = { where: vi.fn().mockReturnThis(), andWhere: vi.fn().mockReturnThis(), getCount: vi.fn().mockResolvedValue(0) };
	const reportBuilderFactory = vi.fn((alias: string) => (alias === "report" ? reportCount : reportBuilder));
	const getRepository = vi.fn((entity: { name: string }) => {
		if (entity.name === "Setting") return { find: vi.fn(async () => settings) };
		if (entity.name === "IssueReport") return { findOne: vi.fn(async () => ({ userId: USER_ID })), update: reportUpdate, createQueryBuilder: reportBuilderFactory };
		if (entity.name === "IssueReportUpdate") return { insert: updateInsert, createQueryBuilder: vi.fn(() => updateBuilder) };
		return { findOne: vi.fn(async () => null) };
	});
	const dataSource = { query, transaction, getRepository } as unknown as DataSource;
	const auth = {
		getAuthenticatedUser: vi.fn(async () => user),
		requireAdmin: vi.fn(async () => undefined),
		requireAdminSession: vi.fn(async () => ({ user, session: {} })),
	} as unknown as AuthService;
	const chat = {
		createSupportGroup: vi.fn(),
		supportChatChanged: vi.fn(),
		ensureSupportRequester: vi.fn(),
	} as unknown as ChatService;
	return {
		service: new IssueReportsService(dataSource, auth, chat),
		query,
		transaction,
		manager,
		deleteBuilder,
		setDeleteAffected: (affected: number) => {
			deleteAffected = affected;
		},
		reportBuilder,
		updateBuilder,
		notificationDelete,
		reportDelete,
		reportInsert,
		reportUpdate,
		updateInsert,
		reportCount,
		auth,
		chat,
	};

}

describe("IssueReportsService", () => {
	it("creates a user-owned report and exposes its public updates", async () => {
		const { service, transaction, reportInsert, updateInsert, reportCount } = createService();
		const report = await service.create("Bearer token", {
			title: "  Playback issue ",
			category: "Playback",
			description: " The video stops. ",
		});

		expect(report).toMatchObject({
			id: REPORT_ID,
			title: "Playback issue",
			description: "The video stops.",
			requester: { username: "viewer" },
			updates: [{ body: "Issue report submitted.", isInternal: false }],
		});
		expect(transaction).toHaveBeenCalledOnce();
		expect(reportCount.where).toHaveBeenCalledWith("report.userId = :userId", { userId: USER_ID });
		expect(reportCount.andWhere).toHaveBeenCalledWith("report.createdAt > now() - interval '24 hours'");
		expect(reportInsert).toHaveBeenCalledWith(expect.objectContaining({ userId: USER_ID, title: "Playback issue", category: "Playback", description: "The video stops." }));
		expect(updateInsert).toHaveBeenCalledWith(expect.objectContaining({ body: "Issue report submitted." }));
	});

	it("rejects report creation when reporting is disabled", async () => {
		const { service, transaction } = createService({ enabled: false, chatEnabled: true, categories: ["Other"] });
		await expect(service.create("Bearer token", { title: "Issue", category: "Other", description: "Details" })).rejects.toThrow(/disabled/);
		expect(transaction).not.toHaveBeenCalled();
	});

	it("rejects categories not configured by the administrator", async () => {
		const { service, transaction } = createService();
		await expect(service.create("Bearer token", { title: "Issue", category: "Invalid", description: "Details" })).rejects.toThrow(/category/);
		expect(transaction).not.toHaveBeenCalled();
	});

	it("filters private notes from user ticket details", async () => {
		const { service, updateBuilder } = createService();
		const report = await service.userDetail(REPORT_ID, user);
		expect(updateBuilder.where).toHaveBeenCalledWith("update.reportId = :id", { id: REPORT_ID });
		expect(updateBuilder.andWhere).toHaveBeenCalledWith("update.isInternal = false");
		expect(report.updates).toHaveLength(1);
	});

	it("clears resolved timestamps when changing to an unresolved status", async () => {
		const { service, manager } = createService();
		await service.setStatus(REPORT_ID, "in_progress", "Bearer admin");

		expect(manager.update).toHaveBeenCalledWith(IssueReportEntity, { id: REPORT_ID }, { status: "in_progress", resolvedAt: null, updatedAt: expect.any(Function) });
	});

	it("notifies the chat page when an admin closes a support chat", async () => {
		const conversationId = "33333333-3333-4333-8333-333333333333";
		const { service, chat, reportUpdate } = createService(undefined, "open", conversationId, true);
		await service.setChat(REPORT_ID, false, "Bearer admin");

		expect(chat.supportChatChanged).toHaveBeenCalledWith(conversationId);
		expect(reportUpdate).toHaveBeenCalledWith({ id: REPORT_ID }, { chatOpen: false, updatedAt: expect.any(Function) });
	});

	it("re-adds the requester when an admin reopens an existing support chat", async () => {
		const conversationId = "33333333-3333-4333-8333-333333333333";
		const { service, chat } = createService(undefined, "open", conversationId, true);
		await service.setChat(REPORT_ID, true, "******");

		expect(chat.ensureSupportRequester).toHaveBeenCalledWith(conversationId, USER_ID);
		expect(chat.supportChatChanged).not.toHaveBeenCalled();
	});

	it("allows admins to delete closed reports and their unshared support chats", async () => {
		const { service, manager, transaction, notificationDelete, reportDelete, deleteBuilder } = createService(undefined, "closed");
		await service.deleteClosed(REPORT_ID, "Bearer admin");

		expect(transaction).toHaveBeenCalledOnce();
		expect(manager.findOne).toHaveBeenCalledWith(IssueReportEntity, { select: { status: true, conversationId: true }, where: { id: REPORT_ID }, lock: { mode: "pessimistic_write" } });
		expect(deleteBuilder.where).toHaveBeenCalledWith(expect.stringContaining("NOT EXISTS"), { conversationId: "33333333-3333-4333-8333-333333333333" });
		expect(reportDelete).toHaveBeenCalledWith({ id: REPORT_ID });
		expect(notificationDelete).toHaveBeenCalledWith({ kind: "message", url: "/chat/33333333-3333-4333-8333-333333333333" });
	});

	it("does not delete reports that are not closed", async () => {
		const { service, manager } = createService(undefined, "resolved");
		await expect(service.deleteClosed(REPORT_ID, "Bearer admin")).rejects.toThrow(/only closed/i);
		expect(manager.findOne).toHaveBeenCalledOnce();
	});

	it("keeps notifications when the conversation is still shared", async () => {
		const { service, setDeleteAffected, notificationDelete } = createService(undefined, "closed");
		setDeleteAffected(0);
		await service.deleteClosed(REPORT_ID, "Bearer admin");
		expect(notificationDelete).not.toHaveBeenCalled();
	});

	it("rejects non-UUID ticket ids without querying the database", async () => {
		const { service, query } = createService();
		await expect(service.adminDetail("invalid", "Bearer admin")).rejects.toThrow(/not found/i);
		expect(query).not.toHaveBeenCalled();
	});
});
