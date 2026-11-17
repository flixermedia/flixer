import { createServer } from "node:http";
import { once } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { DataSource } from "typeorm";
import { CreateUserWebhooks1798300000009 } from "../../migrations/createUserWebhooks1798300000009.js";
import { DefaultUserWebhookUrlRules1798300000010 } from "../../migrations/defaultUserWebhookUrlRules1798300000010.js";
import { UserWebhookService } from "./userWebhookService.js";

describe.skipIf(!process.env.WEBHOOK_TEST_PG_SOCKET)("user webhooks (isolated PostgreSQL)", () => {
	it("migrates, enforces ownership, delivers ordered events and rolls back", async () => {
		const source = new DataSource({ type: "postgres", host: process.env.WEBHOOK_TEST_PG_SOCKET, port: 55442, username: process.env.USER, database: "webhook_test" });
		await source.initialize();
		const runner = source.createQueryRunner();
		const migration = new CreateUserWebhooks1798300000009();
		const rulesMigration = new DefaultUserWebhookUrlRules1798300000010();
		const received: Array<{ event: string; userId: string }> = [];
		const server = createServer((request, response) => {
			let body = "";
			request.setEncoding("utf8");
			request.on("data", (chunk: string) => { body += chunk; });
			request.on("end", () => {
				received.push(JSON.parse(body) as { event: string; userId: string });
				response.writeHead(204).end();
			});
		});
		server.listen(0, "127.0.0.1");
		await once(server, "listening");
		const address = server.address();
		if (!address || typeof address === "string") throw new Error("Missing test server address.");
		const url = `http://127.0.0.1:${address.port}/automation`;
		const user = { id: "d3929747-385b-4245-a8d2-682c37626192", role: "user" };
		const other = { id: "e3929747-385b-4245-a8d2-682c37626192", role: "user" };
		const item = "a89c26d2-513c-4528-9d8b-7ca16004bf72";
		try {
			await runner.query("CREATE TABLE users (id uuid PRIMARY KEY, role text, disabled_at timestamptz)");
			await runner.query("CREATE TABLE media_items (id uuid PRIMARY KEY, title text, type varchar(16))");
			await migration.up(runner);
			await rulesMigration.up(runner);
			await runner.query("INSERT INTO users VALUES ($1, 'user', NULL), ($2, 'user', NULL)", [user.id, other.id]);
			await runner.query("INSERT INTO media_items VALUES ($1, 'Movie', 'movie')", [item]);
			const access = { resolve: async () => ({}), visibleIds: async (_policy: unknown, ids: string[]) => new Set(ids) };
			const service = new UserWebhookService(source, access as never);
			expect(await service.config()).toEqual({ enabled: false, audience: "admins", allowedUrls: ["regex:https?://.*"] });
			await service.updateConfig({ enabled: true, audience: "everyone", allowedUrls: ["regex:http://127\\.0\\.0\\.1:[0-9]+/automation"] });
			const hook = await service.save(user, { name: "Lights", url, enabled: true });
			await expect(service.remove(other, hook.id)).rejects.toThrow("not found");
			await expect(service.save(other, { name: "Stolen", url, enabled: true }, hook.id)).rejects.toThrow("not found");
			expect((await service.save(user, { name: "Living room", url, enabled: true }, hook.id)).name).toBe("Living room");
			await service.report(other, { event: "playback.started", target: { kind: "video", itemId: item }, position: 0 });
			await service.report(user, { event: "playback.started", target: { kind: "video", itemId: item }, position: 0 });
			await service.report(user, { event: "playback.paused", target: { kind: "video", itemId: item }, position: 5 });
			await vi.waitFor(() => expect(received).toHaveLength(2));
			expect(received.map((entry) => entry.event)).toEqual(["playback.started", "playback.paused"]);
			expect(received.every((entry) => entry.userId === user.id)).toBe(true);
			await service.updateConfig({ enabled: false, audience: "everyone", allowedUrls: [url] });
			await service.report(user, { event: "playback.resumed", target: { kind: "video", itemId: item }, position: 5 });
			expect(received).toHaveLength(2);
			await service.remove(user, hook.id);
			await service.updateConfig({ enabled: true, audience: "everyone", allowedUrls: [url] });
			const created = await Promise.allSettled(Array.from({ length: 15 }, (_, i) => service.save(user, { name: `Hook ${i}`, url, enabled: true })));
			expect(created.filter((result) => result.status === "fulfilled")).toHaveLength(10);
			await rulesMigration.down(runner);
			await rulesMigration.up(runner);
			expect((await service.config()).allowedUrls).toEqual([url]);
			await rulesMigration.down(runner);
			await migration.down(runner);
			expect((await runner.query("SELECT to_regclass('user_webhooks') AS name"))[0].name).toBeNull();
		} finally {
			await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
			await runner.query("DROP TABLE IF EXISTS user_webhooks; DROP TABLE IF EXISTS user_webhook_config; DROP TABLE IF EXISTS media_items; DROP TABLE IF EXISTS users");
			await runner.release();
			await source.destroy();
		}
	});
});
