import { afterEach, describe, expect, it, vi } from "vitest";
import { MediaItem } from "../../entities/mediaItem.entity.js";
import { UserWebhook, UserWebhookConfig } from "../../entities/userWebhook.entity.js";
import { AdminUserWebhookController, UserWebhookController } from "./userWebhookController.js";
import { UserWebhookService, webhookUrl } from "./userWebhookService.js";

const user = { id: "d3929747-385b-4245-a8d2-682c37626192", role: "user" };
const itemId = "a89c26d2-513c-4528-9d8b-7ca16004bf72";
const hookId = "b89c26d2-513c-4528-9d8b-7ca16004bf72";
const url = "http://home.local/automation";
const report = { event: "playback.started", target: { kind: "video", itemId }, position: 5 };
const access = { resolve: vi.fn().mockResolvedValue({}), visibleIds: vi.fn().mockResolvedValue(new Set([itemId])) };

afterEach(() => vi.unstubAllGlobals());

type ConfigRow = { enabled: boolean; audience: string; allowedUrls: string[] };

/** A data source whose repositories and query-builder results are mocked. */
function makeSource(options: { config?: () => ConfigRow | null; hooks?: unknown[]; deleted?: number; query?: (sql: string, params?: unknown[]) => Promise<unknown[]> } = {}) {

	const configs = { findOneBy: vi.fn(async () => (options.config ? options.config() : null)), update: vi.fn() };
	const hooks = { find: vi.fn(async () => options.hooks ?? []), delete: vi.fn(async () => ({ affected: options.deleted ?? 0 })) };
	const query = options.query ?? (vi.fn().mockResolvedValue([]) as (sql: string, params?: unknown[]) => Promise<unknown[]>);
	let update: Record<string, unknown> = {};
	let criteria: Record<string, unknown> = {};
	const updateBuilder = {
		update: vi.fn(),
		set: vi.fn((values: Record<string, unknown>) => {
			update = values;
			return updateBuilder;
		}),
		where: vi.fn((_sql: string, values: Record<string, unknown>) => {
			criteria = values;
			return updateBuilder;
		}),
		returning: vi.fn(),
		execute: vi.fn(async () => ({ raw: await query("UPDATE user_webhooks", [criteria.id, criteria.userId, update.name, update.url, update.enabled]) })),
		innerJoin: vi.fn(),
		select: vi.fn(),
		andWhere: vi.fn(),
		getRawOne: vi.fn(async () => (await query("JOIN users"))[0] ?? null),
	};
	for (const name of ["update", "returning", "innerJoin", "select", "where", "andWhere"] as const) updateBuilder[name].mockReturnValue(updateBuilder);
	const lockBuilder = { select: vi.fn(), setParameter: vi.fn(), getRawOne: vi.fn().mockResolvedValue({ locked: null }) };
	for (const name of ["select", "setParameter"] as const) lockBuilder[name].mockReturnValue(lockBuilder);
	const transaction = vi.fn(async (work: (manager: unknown) => Promise<unknown>) => work({ createQueryBuilder: () => lockBuilder, count: vi.fn().mockResolvedValue(0), insert: vi.fn().mockResolvedValue({}) }));
	const dataSource = {
		getRepository: vi.fn((entity: unknown) => (entity === UserWebhookConfig ? configs : entity === UserWebhook ? { ...hooks, createQueryBuilder: vi.fn(() => updateBuilder) } : entity === MediaItem ? { findOne: vi.fn(async () => (await query("FROM media_items"))[0] ?? null) } : undefined)),
		transaction,
	};
	return { dataSource, configs, hooks, query, transaction };

}

describe("personal webhooks", () => {
	it("requires an admin for policy and binds user actions to the authenticated user", async () => {
		const auth = { requireAdmin: vi.fn().mockRejectedValue(new Error("forbidden")), getAuthenticatedUser: vi.fn().mockResolvedValue(user) };
		const service = { config: vi.fn(), report: vi.fn() };
		await expect(new AdminUserWebhookController(auth as never, service as never).config("token")).rejects.toThrow("forbidden");
		expect(service.config).not.toHaveBeenCalled();
		await new UserWebhookController(auth as never, service as never).playback(report, "token");
		expect(service.report).toHaveBeenCalledWith(user, report, "token");
	});

	it("normalizes approved URLs and rejects unsupported schemes, credentials, and fragments", () => {
		expect(webhookUrl("HTTP://HOME.LOCAL:80/automation")).toBe(url);
		for (const invalid of ["file:///etc/passwd", "http://user:pass@home.local/", "http://home.local/#fragment", " http://home.local/", "not-a-url"]) {
			expect(() => webhookUrl(invalid)).toThrow();
		}
	});

	it("defaults to no reports or writes when disabled or limited to admins", async () => {
		let config: ConfigRow = { enabled: false, audience: "admins", allowedUrls: [url] };
		const { dataSource, hooks, query } = makeSource({ config: () => config });
		const service = new UserWebhookService(dataSource as never, access as never);
		await service.report(user, report);
		await expect(service.save(user, { name: "Home", url, enabled: true })).rejects.toThrow("not enabled");
		config = { enabled: true, audience: "admins", allowedUrls: [url] };
		await service.report(user, report);
		await expect(service.save(user, { name: "Home", url, enabled: true })).rejects.toThrow("not enabled");
		expect(hooks.find).not.toHaveBeenCalled();
		expect(query).not.toHaveBeenCalled();
	});

	it("limits destinations and deletion to the authenticated owner", async () => {
		const { dataSource, hooks } = makeSource({ config: () => ({ enabled: true, audience: "everyone", allowedUrls: [url] }), deleted: 0 });
		const service = new UserWebhookService(dataSource as never, access as never);
		await expect(service.save(user, { name: "bad", url: "http://127.0.0.1/admin", enabled: true })).rejects.toThrow("not been approved");
		await expect(service.remove(user, hookId)).rejects.toThrow("not found");
		expect(hooks.delete).toHaveBeenCalledWith({ id: hookId, userId: user.id });
	});

	it("validates regex syntax and matches entire normalized URLs during webhook creation", async () => {
		const query = vi.fn(async (sql: string, args?: unknown[]) => (sql.includes("UPDATE user_webhooks") ? [{ id: hookId, name: "Home", url: args?.[3], enabled: true }] : []));
		const { dataSource } = makeSource({ config: () => ({ enabled: true, audience: "everyone", allowedUrls: ["regex:https://automation\\.example\\.com/.*", url] }), query });
		const service = new UserWebhookService(dataSource as never, access as never);
		await expect(service.save(user, { name: "Home", url: "https://AUTOMATION.example.com/hook?key=x", enabled: true }, hookId)).resolves.toMatchObject({ url: "https://automation.example.com/hook?key=x" });
		await expect(service.save(user, { name: "Home", url: "https://automation.example.com.evil/hook", enabled: true }, hookId)).rejects.toThrow("not been approved");
		await expect(service.save(user, { name: "Home", url, enabled: true }, hookId)).resolves.toMatchObject({ url });
		for (const rule of ["regex:", "regex:(", "regex:(?=http).*", `regex:${"x".repeat(513)}`]) {
			await expect(service.updateConfig({ enabled: true, audience: "everyone", allowedUrls: [rule] })).rejects.toThrow("regex");
		}
	});

	it("accepts HTTP and HTTPS with the default rule without allowing other schemes", async () => {
		const query = vi.fn(async (_sql: string, args?: unknown[]) => [{ id: hookId, url: args?.[3] }]);
		const { dataSource } = makeSource({ config: () => ({ enabled: true, audience: "everyone", allowedUrls: ["regex:https?://.*"] }), query });
		const service = new UserWebhookService(dataSource as never, access as never);
		for (const destination of ["http://127.0.0.1:8123/", "https://public.example/path"]) {
			await expect(service.save(user, { name: "Home", url: destination, enabled: true }, hookId)).resolves.toMatchObject({ url: destination });
		}
		await expect(service.save(user, { name: "Home", url: "file:///etc/passwd", enabled: true }, hookId)).rejects.toThrow();
	});

	it("rechecks regex permissions when queued deliveries are sent", async () => {
		let approved = true;
		let release: (() => void) | undefined;
		const query = vi.fn(async (sql: string) => {
			if (sql.includes("FROM media_items")) return [{ id: itemId, title: "Movie", type: "movie" }];
			if (sql.includes("JOIN users")) return [{ id: hookId }];
			return [];
		});
		const { dataSource, configs } = makeSource({ config: () => ({ enabled: true, audience: "everyone", allowedUrls: approved ? ["regex:http://home\\.local/.*"] : [] }), hooks: [{ id: hookId, name: "Home", enabled: true, url }], query });
		const fetchMock = vi.fn().mockImplementationOnce(async () => {
			await new Promise<void>((resolve) => {
				release = resolve;
			});
			return { ok: true, status: 200, body: null };
		});
		vi.stubGlobal("fetch", fetchMock);
		const service = new UserWebhookService(dataSource as never, access as never);
		await service.report(user, report);
		await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
		await service.report(user, report);
		approved = false;
		release?.();
		await vi.waitFor(() => expect(configs.findOneBy).toHaveBeenCalledTimes(4));
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("sends only approved, owned webhooks with a user-bound payload and no redirects", async () => {
		const query = vi.fn(async (sql: string, _args?: unknown[]) => {
			if (sql.includes("FROM media_items")) return [{ id: itemId, title: "Movie", type: "movie" }];
			if (sql.includes("JOIN users")) return [{ id: hookId }];
			return [];
		});
		const { dataSource, hooks } = makeSource({
			config: () => ({ enabled: true, audience: "everyone", allowedUrls: [url] }),
			hooks: [
				{ id: hookId, name: "Home", enabled: true, url },
				{ id: "unapproved", name: "Other", enabled: true, url: "http://other/" },
			],
			query,
		});
		const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, body: null });
		vi.stubGlobal("fetch", fetchMock);
		const service = new UserWebhookService(dataSource as never, access as never);
		await service.report(user, report);
		await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
		const [destination, options] = fetchMock.mock.calls[0]!;
		expect(destination).toBe(url);
		expect(options.redirect).toBe("error");
		expect(JSON.parse(options.body)).toMatchObject({ event: report.event, userId: user.id, positionSeconds: 5, media: { id: itemId, title: "Movie", kind: "video" } });
		expect(hooks.find).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: user.id, enabled: true } }));
	});

	it("does not disclose metadata for restricted media", async () => {
		const { dataSource, query } = makeSource({ config: () => ({ enabled: true, audience: "everyone", allowedUrls: [url] }), hooks: [{ id: hookId, name: "Home", url, enabled: true }] });
		const denied = { resolve: vi.fn().mockResolvedValue({}), visibleIds: vi.fn().mockResolvedValue(new Set()) };
		const service = new UserWebhookService(dataSource as never, denied as never);
		await expect(service.report(user, report, "token")).rejects.toThrow("not found");
		expect(denied.resolve).toHaveBeenCalledWith("token");
		expect(query).not.toHaveBeenCalled();
	});
});
