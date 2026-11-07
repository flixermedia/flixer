import { afterEach, describe, expect, it, vi } from "vitest";
import { AdminUserWebhookController, UserWebhookController } from "./userWebhookController.js";
import { UserWebhookService, webhookUrl } from "./userWebhookService.js";

const user = { id: "d3929747-385b-4245-a8d2-682c37626192", role: "user" };
const itemId = "a89c26d2-513c-4528-9d8b-7ca16004bf72";
const hookId = "b89c26d2-513c-4528-9d8b-7ca16004bf72";
const url = "http://home.local/automation";
const report = { event: "playback.started", target: { kind: "video", itemId }, position: 5 };
const access = { resolve: vi.fn().mockResolvedValue({}), visibleIds: vi.fn().mockResolvedValue(new Set([itemId])) };

afterEach(() => vi.unstubAllGlobals());

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
		const query = vi.fn().mockResolvedValue([{ enabled: false, audience: "admins", allowed_urls: [url] }]);
		const service = new UserWebhookService({ query } as never, access as never);
		await service.report(user, report);
		await expect(service.save(user, { name: "Home", url, enabled: true })).rejects.toThrow("not enabled");
		query.mockResolvedValue([{ enabled: true, audience: "admins", allowed_urls: [url] }]);
		await service.report(user, report);
		await expect(service.save(user, { name: "Home", url, enabled: true })).rejects.toThrow("not enabled");
		expect(query.mock.calls.every(([sql]) => sql.includes("user_webhook_config"))).toBe(true);
	});

	it("limits destinations and deletion to the authenticated owner", async () => {
		const query = vi.fn().mockResolvedValueOnce([{ enabled: true, audience: "everyone", allowed_urls: [url] }]).mockResolvedValueOnce([]);
		const service = new UserWebhookService({ query } as never, access as never);
		await expect(service.save(user, { name: "bad", url: "http://127.0.0.1/admin", enabled: true })).rejects.toThrow("not been approved");
		await expect(service.remove(user, hookId)).rejects.toThrow("not found");
		expect(query.mock.calls[1]?.[1]).toEqual([hookId, user.id]);
		expect(query.mock.calls[1]?.[0]).toContain("user_id = $2");
	});

	it("validates regex syntax and matches entire normalized URLs during webhook creation", async () => {
		const query = vi.fn(async (sql: string, args?: unknown[]) => {
			if (sql.includes("user_webhook_config")) return [{ enabled: true, audience: "everyone", allowed_urls: ["regex:https://automation\\.example\\.com/.*", url] }];
			if (sql.includes("UPDATE user_webhooks")) return [{ id: hookId, name: "Home", url: args?.[3], enabled: true }];
			return [];
		});
		const service = new UserWebhookService({ query } as never, access as never);
		await expect(service.save(user, { name: "Home", url: "https://AUTOMATION.example.com/hook?key=x", enabled: true }, hookId)).resolves.toMatchObject({ url: "https://automation.example.com/hook?key=x" });
		await expect(service.save(user, { name: "Home", url: "https://automation.example.com.evil/hook", enabled: true }, hookId)).rejects.toThrow("not been approved");
		await expect(service.save(user, { name: "Home", url, enabled: true }, hookId)).resolves.toMatchObject({ url });
		for (const rule of ["regex:", "regex:(", "regex:(?=http).*", `regex:${"x".repeat(513)}`]) {
			await expect(service.updateConfig({ enabled: true, audience: "everyone", allowedUrls: [rule] })).rejects.toThrow("regex");
		}
	});

	it("accepts HTTP and HTTPS with the default rule without allowing other schemes", async () => {
		const query = vi.fn(async (sql: string, args?: unknown[]) => sql.includes("user_webhook_config")
			? [{ enabled: true, audience: "everyone", allowed_urls: ["regex:https?://.*"] }]
			: [{ id: hookId, url: args?.[3] }]);
		const service = new UserWebhookService({ query } as never, access as never);
		for (const destination of ["http://127.0.0.1:8123/", "https://public.example/path"]) {
			await expect(service.save(user, { name: "Home", url: destination, enabled: true }, hookId)).resolves.toMatchObject({ url: destination });
		}
		await expect(service.save(user, { name: "Home", url: "file:///etc/passwd", enabled: true }, hookId)).rejects.toThrow();
	});

	it("rechecks regex permissions when queued deliveries are sent", async () => {
		let approved = true;
		let release: (() => void) | undefined;
		const query = vi.fn(async (sql: string) => {
			if (sql.includes("user_webhook_config")) return [{ enabled: true, audience: "everyone", allowed_urls: approved ? ["regex:http://home\\.local/.*"] : [] }];
			if (sql.includes("FROM media_items")) return [{ id: itemId, title: "Movie", type: "movie" }];
			if (sql.includes("FROM user_webhooks WHERE")) return [{ id: hookId, name: "Home", enabled: true, url }];
			if (sql.includes("JOIN users")) return [{ id: hookId }];
			return [];
		});
		const fetchMock = vi.fn().mockImplementationOnce(async () => {
			await new Promise<void>((resolve) => { release = resolve; });
			return { ok: true, status: 200, body: null };
		});
		vi.stubGlobal("fetch", fetchMock);
		const service = new UserWebhookService({ query } as never, access as never);
		await service.report(user, report);
		await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
		await service.report(user, report);
		approved = false;
		release?.();
		await vi.waitFor(() => expect(query.mock.calls.filter(([sql]) => sql.includes("user_webhook_config"))).toHaveLength(4));
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("sends only approved, owned webhooks with a user-bound payload and no redirects", async () => {
		const query = vi.fn(async (sql: string, _args?: unknown[]) => {
			if (sql.includes("user_webhook_config")) return [{ enabled: true, audience: "everyone", allowed_urls: [url] }];
			if (sql.includes("FROM media_items")) return [{ id: itemId, title: "Movie", type: "movie" }];
			if (sql.includes("JOIN users")) return [{ id: hookId }];
			if (sql.includes("FROM user_webhooks")) return [{ id: hookId, name: "Home", enabled: true, url }, { id: "unapproved", name: "Other", enabled: true, url: "http://other/" }];
			return [];
		});
		const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, body: null });
		vi.stubGlobal("fetch", fetchMock);
		const service = new UserWebhookService({ query } as never, access as never);
		await service.report(user, report);
		await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
		const [destination, options] = fetchMock.mock.calls[0]!;
		expect(destination).toBe(url);
		expect(options.redirect).toBe("error");
		expect(JSON.parse(options.body)).toMatchObject({ event: report.event, userId: user.id, positionSeconds: 5, media: { id: itemId, title: "Movie", kind: "video" } });
		const ownerQuery = query.mock.calls.find(([sql]) => sql.includes("FROM user_webhooks WHERE user_id"));
		expect(ownerQuery?.[1]).toEqual([user.id]);
	});

	it("does not disclose metadata for restricted media", async () => {
		const query = vi.fn(async (sql: string) => sql.includes("user_webhook_config")
			? [{ enabled: true, audience: "everyone", allowed_urls: [url] }]
			: [{ id: hookId, name: "Home", url, enabled: true }]);
		const denied = { resolve: vi.fn().mockResolvedValue({}), visibleIds: vi.fn().mockResolvedValue(new Set()) };
		const service = new UserWebhookService({ query } as never, denied as never);
		await expect(service.report(user, report, "token")).rejects.toThrow("not found");
		expect(denied.resolve).toHaveBeenCalledWith("token");
		expect(query.mock.calls.some(([sql]) => sql.includes("media_items"))).toBe(false);
	});
});
