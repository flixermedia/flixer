import { describe, expect, it, vi } from "vitest";
import { PageBuilderService } from "./pageBuilderService.js";
import { LOGIN_LAYOUT_SETTING } from "./appearanceService.js";

function setup() {

	const values = new Map<string, unknown>();
	const repository = {
		findBy: vi.fn(async () => [...values].map(([key, value]) => ({ key, value: structuredClone(value) }))),
		findOneBy: vi.fn(async ({ key }: { key: string }) => (values.has(key) ? { key, value: structuredClone(values.get(key)) } : null)),
		findOne: vi.fn(async ({ where }: { where: { key: string } }) => (values.has(where.key) ? { key: where.key, value: structuredClone(values.get(where.key)) } : null)),
		upsert: vi.fn(async ({ key, value }: { key: string; value: unknown }) => {
			values.set(key, structuredClone(value));
		}),
		delete: vi.fn(async ({ key }: { key: string }) => {
			values.delete(key);
		}),
	};
	const requireAdmin = vi.fn(async (authorization?: string) => {
		if (authorization !== "admin") throw new Error("forbidden");
	});
	const getAuthenticatedUser = vi.fn(async (authorization?: string) => {
		if (!authorization) throw new Error("unauthorized");
		return { id: "user" };
	});
	const source = { getRepository: () => repository, transaction: async (run: (manager: { getRepository: () => typeof repository }) => Promise<unknown>) => run({ getRepository: () => repository }) };
	const service = new PageBuilderService(source as never, { requireAdmin, getAuthenticatedUser } as never);
	return { service, requireAdmin, values };

}

describe("page builder publishing", () => {
	it("requires an administrator for management", async () => {
		const { service } = setup();
		await expect(service.list()).rejects.toThrow("forbidden");
		await expect(service.create()).rejects.toThrow("forbidden");
		await expect(service.publish("login")).rejects.toThrow("forbidden");
	});

	it("keeps drafts private until published and preserves the published version", async () => {
		const { service } = setup();
		const created = await service.create("admin");
		const first = { title: "First", slug: "first", draft: { blocks: [{ id: "text", type: "text", text: "Published", image: null }] } };
		await service.save(created.id, first, "admin");
		await expect(service.publicPage("first")).rejects.toThrow("Page not found.");
		await service.publish(created.id, "admin");
		await service.save(created.id, { ...first, title: "Draft", slug: "draft", draft: { blocks: [{ id: "text", type: "text", text: "Private", image: null }] } }, "admin");
		expect(await service.publicPage("first")).toMatchObject({ title: "First", blocks: [{ text: "Published" }] });
		await expect(service.publicPage("draft")).rejects.toThrow("Page not found.");
		await service.unpublish(created.id, "admin");
		await expect(service.publicPage("first")).rejects.toThrow("Page not found.");
	});

	it("protects the login block and exposes only its published version", async () => {
		const { service, values } = setup();
		await expect(service.publicPage("login")).rejects.toThrow("Page not found.");
		await expect(service.save("login", { title: "Login", draft: { blocks: [] } }, "admin")).rejects.toThrow();
		await service.publish("login", "admin");
		expect((await service.publicPage("login")).blocks).toMatchObject([{ type: "auth" }]);
		values.set(LOGIN_LAYOUT_SETTING, "custom");
		await service.unpublish("login", "admin");
		expect(values.get(LOGIN_LAYOUT_SETTING)).toBe("classic");
		await expect(service.remove("login", "admin")).rejects.toThrow();
	});

	it("rejects addresses used by other drafts or published pages", async () => {
		const { service } = setup();
		const first = await service.create("admin");
		const second = await service.create("admin");
		const draft = { title: "Page", slug: "shared", draft: { blocks: [] } };
		await service.save(first.id, draft, "admin");
		await service.publish(first.id, "admin");
		await service.save(first.id, { ...draft, slug: "new-address" }, "admin");
		await expect(service.save(second.id, draft, "admin")).rejects.toThrow("already in use");
	});

	it("enforces published access without exposing restricted content", async () => {
		const { service } = setup();
		const page = await service.create("admin");
		await service.save(page.id, { title: "Private", slug: "private", access: "signed-in", draft: { blocks: [{ id: "content", type: "text", text: "Secret", image: null }] } }, "admin");
		await service.publish(page.id, "admin");
		await expect(service.publicPage("private")).rejects.toThrow("unauthorized");
		expect(await service.publicPage("private", "user")).toMatchObject({ access: "signed-in", blocks: [{ text: "Secret" }] });
		await expect(service.save("login", { title: "Login", access: "signed-in", draft: { blocks: [{ id: "auth", type: "auth", text: "", image: null }] } }, "admin")).rejects.toThrow("login page must be public");
	});

	it("publishes a frozen scheduled snapshot and restores past versions as drafts", async () => {
		const { service } = setup();
		const created = await service.create("admin");
		const draft = { title: "First", slug: "first", draft: { blocks: [{ id: "text", type: "text", text: "Scheduled", image: null }] } };
		await service.save(created.id, draft, "admin");
		const at = new Date(Date.now() + 60_000);
		await service.schedule(created.id, { at: at.toISOString() }, "admin");
		await service.save(created.id, { ...draft, title: "Later", draft: { blocks: [{ id: "text", type: "text", text: "Draft", image: null }] } }, "admin");
		await service.publishDue(new Date(at.getTime() + 1));
		expect(await service.publicPage("first")).toMatchObject({ title: "First", blocks: [{ text: "Scheduled" }] });
		const page = (await service.list("admin")).find((item) => item.id === created.id)!;
		expect(page.draft.blocks[0].text).toBe("Draft");
		expect(page.scheduled).toBeNull();
		const restored = await service.restore(created.id, page.history![0].id, "admin");
		expect(restored.draft.blocks[0].text).toBe("Scheduled");
	});

	it("activates a scheduled login page and permits cancelling schedules", async () => {
		const { service, values } = setup();
		const at = new Date(Date.now() + 60_000);
		await service.schedule("login", { at: at.toISOString() }, "admin");
		await service.cancelSchedule("login", "admin");
		await service.publishDue(new Date(at.getTime() + 1));
		expect(values.get(LOGIN_LAYOUT_SETTING)).toBeUndefined();
		await service.schedule("login", { at: at.toISOString() }, "admin");
		await service.publishDue(new Date(at.getTime() + 1));
		expect(values.get(LOGIN_LAYOUT_SETTING)).toBe("custom");
	});

	it("filters restricted navigation and protects a restricted home page", async () => {
		const { service } = setup();
		expect(await service.home()).toBeNull();
		const page = await service.create("admin");
		await service.save(page.id, { title: "Members", slug: "members", access: "signed-in", draft: { blocks: [] } }, "admin");
		await service.publish(page.id, "admin");
		await service.saveSite({ homePageId: page.id, navigationIds: [page.id] }, "admin");
		expect(await service.navigation()).toEqual([]);
		expect(await service.navigation("user")).toEqual([{ title: "Members", slug: "members" }]);
		await expect(service.home()).rejects.toThrow("unauthorized");
		expect(await service.home("user")).toMatchObject({ title: "Members" });
		await expect(service.saveSite({ homePageId: "login", navigationIds: [] }, "admin")).rejects.toThrow("published pages");
	});

	it("keeps reusable blocks admin-only and rejects authentication blocks", async () => {
		const { service } = setup();
		await expect(service.templates()).rejects.toThrow("forbidden");
		const block = { id: "heading", type: "heading", text: "Welcome", image: null };
		const template = await service.createTemplate({ name: "Welcome", block }, "admin");
		expect(await service.templates("admin")).toMatchObject([{ name: "Welcome", block }]);
		await expect(service.createTemplate({ name: "Login", block: { ...block, type: "auth" } }, "admin")).rejects.toThrow();
		await service.removeTemplate(template.id, "admin");
		expect(await service.templates("admin")).toEqual([]);
	});
});
