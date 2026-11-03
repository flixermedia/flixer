import { describe, expect, it, vi } from "vitest";
import type { DataSource } from "typeorm";
import type { AuthService, PublicUser } from "../auth/authService.js";
import type { ChatService } from "../../chat/chatService.js";
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
		if (sql.includes("SELECT key, value FROM settings")) {
			return [
				{ key: "issue_reports_enabled", value: config.enabled },
				{ key: "issue_reports_categories", value: config.categories },
				{ key: "issue_reports_chat_enabled", value: config.chatEnabled },
			];
		}
		if (sql.includes("SELECT count(*)::int AS count")) return [{ count: 0 }];
		if (sql.includes("FROM issue_reports r")) return [row];
		if (sql.includes("FROM issue_report_updates")) {
			return [{ id: "update-id", body: "Issue report submitted.", is_internal: false, created_at: now, username: null, display_name: null }];
		}
		if (sql.includes("SELECT user_id FROM issue_reports")) return [{ user_id: USER_ID }];
		return [];
	});
	const manager = {
		query: vi.fn(async (sql: string, params: unknown[] = []) => {
			if (sql.includes("SELECT status, conversation_id FROM issue_reports")) {
				return [{ status: reportStatus, conversation_id: "33333333-3333-4333-8333-333333333333" }];
			}
			if (sql.includes("DELETE FROM chat_conversations")) return [{ id: params[0] }];
			return [];
		}),
	};
	const transaction = vi.fn(async (work: (manager: typeof manager) => Promise<unknown>) => work(manager));
	const dataSource = { query, transaction } as unknown as DataSource;
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
	return { service: new IssueReportsService(dataSource, auth, chat), query, transaction, manager, auth, chat };

}

describe("IssueReportsService", () => {
	it("creates a user-owned report and exposes its public updates", async () => {
		const { service, transaction } = createService();
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
		const { service, query } = createService();
		const report = await service.userDetail(REPORT_ID, user);
		const updateQuery = query.mock.calls.find(([sql]) => sql.includes("FROM issue_report_updates"));
		expect(updateQuery?.[1]).toEqual([REPORT_ID, false]);
		expect(report.updates).toHaveLength(1);
	});

	it("uses a separate boolean parameter to set resolved timestamps when changing status", async () => {
		const { service, manager } = createService();
		await service.setStatus(REPORT_ID, "in_progress", "Bearer admin");

		const update = manager.query.mock.calls.find(([sql]) => String(sql).includes("UPDATE issue_reports SET status"));
		expect(update?.[0]).toContain("resolved_at = CASE WHEN $3 THEN now()");
		expect(update?.[1]).toEqual([REPORT_ID, "in_progress", false]);
	});

	it("notifies the chat page when an admin closes a support chat", async () => {
		const conversationId = "33333333-3333-4333-8333-333333333333";
		const { service, chat } = createService(undefined, "open", conversationId, true);
		await service.setChat(REPORT_ID, false, "Bearer admin");

		expect(chat.supportChatChanged).toHaveBeenCalledWith(conversationId);
	});

	it("re-adds the requester when an admin reopens an existing support chat", async () => {
		const conversationId = "33333333-3333-4333-8333-333333333333";
		const { service, chat } = createService(undefined, "open", conversationId, true);
		await service.setChat(REPORT_ID, true, "******");

		expect(chat.ensureSupportRequester).toHaveBeenCalledWith(conversationId, USER_ID);
		expect(chat.supportChatChanged).not.toHaveBeenCalled();
	});

	it("allows admins to delete closed reports and their unshared support chats", async () => {
		const { service, manager, transaction } = createService(undefined, "closed");
		await service.deleteClosed(REPORT_ID, "Bearer admin");

		expect(transaction).toHaveBeenCalledOnce();
		expect(manager.query.mock.calls.map(([sql]) => sql)).toEqual([expect.stringContaining("FOR UPDATE"), expect.stringContaining("DELETE FROM issue_reports"), expect.stringContaining("DELETE FROM chat_conversations"), expect.stringContaining("DELETE FROM notifications")]);
	});

	it("does not delete reports that are not closed", async () => {
		const { service, manager } = createService(undefined, "resolved");
		await expect(service.deleteClosed(REPORT_ID, "Bearer admin")).rejects.toThrow(/only closed/i);
		expect(manager.query).toHaveBeenCalledOnce();
	});

	it("rejects non-UUID ticket ids without querying the database", async () => {
		const { service, query } = createService();
		await expect(service.adminDetail("invalid", "Bearer admin")).rejects.toThrow(/not found/i);
		expect(query).not.toHaveBeenCalled();
	});
});
