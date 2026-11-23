// Runs the issue report service against a migrated throwaway schema:
//   ENTITY_SCHEMA_TEST_DATABASE_URL=postgres://... npx vitest run src/api/issues/issueReportsPostgres.spec.ts
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { DataSource } from "typeorm";
import { ChatConversation } from "../../entities/chatConversation.entity.js";
import { IssueReport, IssueReportUpdate } from "../../entities/issueReport.entity.js";
import { Setting } from "../../entities/setting.entity.js";
import { User } from "../../entities/user.entity.js";
import type { ChatService } from "../../chat/chatService.js";
import type { AuthService } from "../auth/authService.js";
import { IssueReportsService } from "./issueReportsService.js";
import { HEAVY_HOOK_TIMEOUT, createIsolatedSchema, type IsolatedSchema } from "../../datasources/testPostgres.js";

const databaseUrl = process.env.ENTITY_SCHEMA_TEST_DATABASE_URL;

describe.skipIf(!databaseUrl)("issue reports with PostgreSQL", () => {
	const userId = randomUUID();
	const adminId = randomUUID();
	let isolated: IsolatedSchema;
	let db: DataSource;
	let service: IssueReportsService;

	beforeAll(async () => {
		isolated = await createIsolatedSchema(databaseUrl as string, { prefix: "issue_reports_test" });
		db = isolated.db;
		await db.getRepository(User).save([
			{ id: userId, username: "reporter", passwordHash: "unused" },
			{ id: adminId, username: "moderator", passwordHash: "unused" },
		]);
		await db.getRepository(Setting).save([
			{ key: "issue_reports_enabled", value: true },
			{ key: "issue_reports_categories", value: ["Playback", "Other"] },
			{ key: "issue_reports_chat_enabled", value: false },
		]);
		const asUser = { id: userId, username: "reporter", displayName: "Reporter" };
		const asAdmin = { id: adminId, username: "moderator", displayName: "Moderator" };
		let current = asUser;
		const auth = {
			getAuthenticatedUser: vi.fn(async () => current),
			requireAdmin: vi.fn(async (header?: string) => {
				current = asAdmin;
				return header;
			}),
			requireAdminSession: vi.fn(async () => ({ user: asAdmin, session: {} })),
		} as unknown as AuthService;
		const chat = {
			createSupportGroup: vi.fn(async () => db.getRepository(ChatConversation).save({ id: randomUUID(), kind: "group", name: "Issue" })),
			ensureSupportRequester: vi.fn(),
			supportChatChanged: vi.fn(),
		} as unknown as ChatService;
		service = new IssueReportsService(db, auth, chat);
	}, HEAVY_HOOK_TIMEOUT);

	afterAll(async () => {
		await isolated?.drop();
	});

	it("creates, lists, updates and deletes a report", async () => {
		const created = await service.create("Bearer user", { title: " Stutter ", category: "Playback", description: "Video stops" });
		expect(created).toMatchObject({ title: "Stutter", category: "Playback", status: "open", chatOpen: false, requester: { username: "reporter" } });
		expect(created.updates).toMatchObject([{ body: "Issue report submitted.", isInternal: false }]);

		const row = await db.getRepository(IssueReport).findOneByOrFail({ id: created.id });
		expect(row).toMatchObject({ userId, mediaItemId: null, conversationId: null, resolvedAt: null, status: "open" });

		expect((await service.mine("Bearer user")).reports.map((report) => report.id)).toEqual([created.id]);

		const noted = await service.addUpdate(created.id, "Looking into it", true, "Bearer admin");
		expect(noted.updates?.map((update) => [update.body, update.isInternal, update.author?.username])).toEqual([
			["Issue report submitted.", false, undefined],
			["Looking into it", true, "moderator"],
		]);
		expect((await service.userDetail(created.id, { id: userId } as never)).updates).toHaveLength(1);

		const resolved = await service.setStatus(created.id, "resolved", "Bearer admin");
		expect(resolved.status).toBe("resolved");
		expect(resolved.resolvedAt).not.toBeNull();
		await expect(service.deleteClosed(created.id, "Bearer admin")).rejects.toThrow(/only closed/i);

		await service.setStatus(created.id, "closed", "Bearer admin");
		await service.deleteClosed(created.id, "Bearer admin");
		expect(await db.getRepository(IssueReport).countBy({ id: created.id })).toBe(0);
		expect(await db.getRepository(IssueReportUpdate).countBy({ reportId: created.id })).toBe(0);
		await expect(service.adminDetail(created.id, "Bearer admin")).rejects.toThrow(/not found/i);
	});

	it("claims a support conversation once and logs chat state changes", async () => {
		await db.getRepository(Setting).update({ key: "issue_reports_chat_enabled" }, { value: true });
		const created = await service.create("Bearer user", { title: "Chat", category: "Other", description: "Needs chat" });
		const opened = await service.setChat(created.id, true, "Bearer admin");
		expect(opened.chatOpen).toBe(true);
		expect(opened.chatConversationId).not.toBeNull();
		expect(opened.updates?.map((update) => update.body)).toContain("Live chat is now open for this issue.");

		const closed = await service.setChat(created.id, false, "Bearer admin");
		expect(closed).toMatchObject({ chatOpen: false, chatConversationId: opened.chatConversationId });
	});

	it("counts only the user's reports from the last 24 hours", async () => {
		const reporterId = randomUUID();
		await db.getRepository(User).save({ id: reporterId, username: "rate-limit-reporter", passwordHash: "unused" });
		const auth = { getAuthenticatedUser: vi.fn(async () => ({ id: reporterId, username: "rate-limit-reporter" })) } as unknown as AuthService;
		const limited = new IssueReportsService(db, auth, {} as ChatService);
		await db.getRepository(IssueReport).insert([...Array.from({ length: 4 }, () => ({ id: randomUUID(), userId: reporterId, title: "Recent", category: "Other", description: "Details" })), { id: randomUUID(), userId: reporterId, title: "Old", category: "Other", description: "Details", createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000) }]);
		await expect(limited.create(undefined, { title: "Fifth", category: "Other", description: "Details" })).resolves.toMatchObject({ title: "Fifth" });
		await expect(limited.create(undefined, { title: "Sixth", category: "Other", description: "Details" })).rejects.toThrow("up to five issue reports per day");
	});
});
