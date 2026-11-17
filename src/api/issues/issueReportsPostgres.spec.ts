// Runs the issue report service against a migrated throwaway schema:
//   ENTITY_SCHEMA_TEST_DATABASE_URL=postgres://... npx vitest run src/api/issues/issueReportsPostgres.spec.ts
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { DataSource } from "typeorm";
import { ENTITIES } from "../../datasources/entityList.js";
import { MIGRATIONS } from "../../datasources/migrationList.js";
import { ChatConversation } from "../../entities/chatConversation.entity.js";
import { IssueReport, IssueReportUpdate } from "../../entities/issueReport.entity.js";
import { Setting } from "../../entities/setting.entity.js";
import { User } from "../../entities/user.entity.js";
import type { ChatService } from "../../chat/chatService.js";
import type { AuthService } from "../auth/authService.js";
import { IssueReportsService } from "./issueReportsService.js";

const databaseUrl = process.env.ENTITY_SCHEMA_TEST_DATABASE_URL;

describe.skipIf(!databaseUrl)("issue reports with PostgreSQL", () => {
	const schema = `issue_reports_test_${randomUUID().replaceAll("-", "")}`;
	const userId = randomUUID();
	const adminId = randomUUID();
	let admin: DataSource;
	let db: DataSource;
	let service: IssueReportsService;

	beforeAll(async () => {
		admin = new DataSource({ type: "postgres", url: databaseUrl });
		await admin.initialize();
		await admin.query(`CREATE SCHEMA "${schema}"`);
		db = new DataSource({ type: "postgres", url: databaseUrl, extra: { options: `-c search_path=${schema}` }, schema, entities: ENTITIES, migrations: MIGRATIONS, synchronize: false });
		await db.initialize();
		await db.runMigrations();
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
	});

	afterAll(async () => {
		if (db?.isInitialized) await db.destroy();
		if (admin?.isInitialized) {
			await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
			await admin.destroy();
		}
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
});
