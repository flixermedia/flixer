import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { DIContext } from "@tsed/di";
import { Logger } from "@tsed/logger";
import { describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import "../../logs/liveLogAppender.js";
import { liveLogHub } from "../../logs/liveLogHub.js";
import { LiveLogSocketServer } from "../../logs/liveLogSocketServer.js";
import { alterRequestLog, logRequestResponse, setLogSuccessfulApiRequests, shouldLogRequestResponse } from "./requestLog.js";

describe("logger administration request logs", () => {
	it("logs failed API requests by default and only logs successful ones when enabled", () => {
		setLogSuccessfulApiRequests(false);
		expect(shouldLogRequestResponse("/api/media", 200)).toBe(false);
		expect(shouldLogRequestResponse("/api/media?limit=10", 304)).toBe(false);
		expect(shouldLogRequestResponse("/api/media", 400)).toBe(true);
		expect(shouldLogRequestResponse("/api/media", 500)).toBe(true);
		expect(shouldLogRequestResponse("/health", 200)).toBe(true);

		setLogSuccessfulApiRequests(true);
		expect(shouldLogRequestResponse("/api/media", 200)).toBe(true);
		setLogSuccessfulApiRequests(false);
	});

	it.each(["/api/internal/ai/logger-configuration", "/api/internal/logger/indexer"])("sanitizes credential responses at %s", (url) => {
		const ctx = new DIContext({ id: "ai-logger" });
		ctx.request = { method: "GET", url, headers: {}, body: {}, query: {}, params: {} };
		const result = alterRequestLog("info", { event: "request.end", status: 200, response: { token: "private" } }, ctx);
		expect(JSON.stringify(result)).not.toContain("private");
	});

	it("does not include owner credentials or exception data", () => {
		const ctx = new DIContext({ id: "owner-test" });
		ctx.request = {
			method: "PUT", url: "/api/admin/logger/owner/configuration?secret=hidden",
			route: "/api/admin/logger/owner/configuration",
			headers: {}, body: { ownerToken: "private-owner-value" }, query: { secret: "hidden" }, params: {},
		};
		const result = alterRequestLog("error", { event: "request.end", status: 400, error_body: "private-owner-value" }, ctx);
		expect(result).toMatchObject({ url: "/api/admin/logger/owner/configuration", status: 400 });
		expect(JSON.stringify(result)).not.toContain("private-owner-value");
		expect(JSON.stringify(result)).not.toContain("hidden");
	});

	it("does not include request credentials, query strings, or exception payloads", () => {
		const ctx = new DIContext({ id: "test" });
		ctx.request = {
			method: "PUT",
			url: "/api/admin/logger/configuration?secret=hidden",
			route: "/api/admin/logger/configuration",
			headers: { authorization: "Bearer hidden" },
			body: { manageToken: "hidden" },
			query: { secret: "hidden" },
			params: {},
		};
		const result = alterRequestLog("error", { event: "request.end", status: 400, state: "KO", error_body: "hidden" }, ctx);
		expect(JSON.stringify(result)).not.toContain("hidden");
		expect(result).toEqual({ method: "PUT", url: "/api/admin/logger/configuration", event: "request.end", status: 400, state: "KO" });
	});

	it("preserves request metadata for other routes", () => {
		const ctx = new DIContext({ id: "test" });
		ctx.request = { method: "GET", url: "/api/other", route: "/api/other", headers: {}, body: {}, query: {}, params: {} };
		expect(alterRequestLog("info", { event: "request.end" }, ctx)).toMatchObject({ event: "request.end", url: "/api/other" });
	});

	it.each([
		{ url: "/api/media?access_token=private-query", status: 500, level: "error" },
		{ url: "/api/other?access_token=private-query", status: 200, level: "info" },
		{ url: "/health?access_token=private-query", status: 400, level: "error" },
	])("does not log credentials or payloads for $url", ({ url, status, level }) => {
		const ctx = new DIContext({ id: "sensitive-request" });
		ctx.request = {
			method: "POST", url, route: url.split("?")[0],
			headers: { authorization: "Bearer private-bearer", cookie: "private-cookie", "x-api-key": "private-key" },
			body: { password: "private-password" }, query: { access_token: "private-query" }, params: {},
		};
		const result = alterRequestLog(level, {
			event: "request.end", status, state: "KO", error_body: "private-error", response: { token: "private-response" },
		}, ctx);
		expect(result).toMatchObject({ method: "POST", url: url.split("?")[0], event: "request.end", status });
		expect(JSON.stringify(result)).not.toContain("private-");
	});

	it.each(["/api/admin/oidc/clients", "/api/oidc/interaction/example/details", "/api/oauth/me/subscriptions"])("does not log OAuth credentials or interaction cookies at %s", (url) => {
		const ctx = new DIContext({ id: "oauth-test" });
		ctx.request = {
			method: "POST", url: `${url}?private-query=value`, route: url, headers: { authorization: "private-token", cookie: "private-cookie" },
			body: { secret: "private-secret" }, query: { "private-query": "value" }, params: {},
		};
		const result = alterRequestLog("error", { event: "request.end", status: 400, error_body: "private-error" }, ctx);
		expect(result).toMatchObject({ url, status: 400 });
		expect(JSON.stringify(result)).not.toContain("private");
	});

	it.each(["/api/auth/providers/example/login?state=private", "/api/admin/plugins/flixer.oauth/oauth-providers?state=private"])("does not log external-provider credentials or callback parameters at %s", (url) => {
		const ctx = new DIContext({ id: "external-auth-test" });
		ctx.request = { method: "POST", url, headers: {}, body: { password: "private-password" }, query: {}, params: {} };
		const result = alterRequestLog("error", { event: "request.end", status: 401, error_body: "private-error" }, ctx);
		expect(JSON.stringify(result)).not.toContain("private");
	});

	it("does not log indexer plugin host-call credentials or settings", () => {
		const ctx = new DIContext({ id: "plugin-host-test" });
		ctx.request = { method: "POST", url: "/api/indexer/plugins/plugin.example/host-calls", headers: {}, body: { secret: "private-token" }, query: {}, params: {} };
		const result = alterRequestLog("error", { event: "request.end", status: 500, response: { apiKey: "private-token" } }, ctx);
		expect(JSON.stringify(result)).not.toContain("private-token");
	});

	it("adds valid trace context to request logs", () => {
		const ctx = new DIContext({ id: "test" });
		ctx.request = {
			method: "GET", url: "/api/internal/ai/library-context", headers: {
				traceparent: `00-${"a".repeat(32)}-${"1".repeat(16)}-01`,
			}, body: {}, query: {}, params: {},
		};
		expect(alterRequestLog("info", { event: "request.end" }, ctx)).toMatchObject({ trace_id: "a".repeat(32) });
	});

	it("keeps credential-bearing request logs sanitized when they have trace context", () => {
		const ctx = new DIContext({ id: "test" });
		ctx.request = {
			method: "PUT", url: "/api/admin/logger/configuration?secret=hidden", route: "/api/admin/logger/configuration", headers: {
				traceparent: `00-${"a".repeat(32)}-${"1".repeat(16)}-01`, authorization: "private",
			},
			body: { token: "private" }, query: { secret: "hidden" }, params: {},
		};
		const result = alterRequestLog("error", { event: "request.end", status: 400, error_body: "private" }, ctx);
		expect(result).toMatchObject({ trace_id: "a".repeat(32), url: "/api/admin/logger/configuration" });
		expect(JSON.stringify(result)).not.toContain("private");
		expect(JSON.stringify(result)).not.toContain("hidden");
	});

	it("logs a route template instead of secret path parameters", () => {
		const ctx = new DIContext({ id: "token-path" });
		ctx.request = {
			method: "POST", url: "/api/friends/invites/private-token/accept", route: "/api/friends/invites/:token/accept",
			headers: {}, body: {}, query: {}, params: { token: "private-token" },
		};
		const result = alterRequestLog("error", { event: "request.end", status: 400 }, ctx);
		expect(result.url).toBe("/api/friends/invites/:token/accept");
		expect(JSON.stringify(result)).not.toContain("private-token");
	});

	it("does not log unmatched attacker-controlled paths", () => {
		const ctx = new DIContext({ id: "unmatched-path" });
		ctx.request = { method: "GET", url: "/private-token", headers: {}, body: {}, query: {}, params: {} };
		const result = alterRequestLog("error", { event: "request.end", status: 404 }, ctx);
		expect(result.url).toBe("[unmatched]");
		expect(JSON.stringify(result)).not.toContain("private-token");
	});

	it("keeps request credentials out of live snapshots and streamed entries", async () => {
		const logger = new Logger("request-log-test");
		logger.appenders.set("live-test", { type: "live" });
		const logRequest = (secret: string) => {
			const ctx = new DIContext({ id: "live-request-test", logger });
			ctx.request = {
				method: "POST", url: `/api/media?token=${secret}`, route: "/api/media",
				headers: { authorization: `Bearer ${secret}`, cookie: secret }, body: { password: secret },
				query: { token: secret }, params: {},
			};
			ctx.response = { statusCode: 500 };
			ctx.error = { message: secret, body: { token: secret } };
			ctx.logger.alterLog((value, level) => alterRequestLog(level, value, ctx));
			logRequestResponse(ctx);
		};
		const server = createServer();
		const sockets = new LiveLogSocketServer(async (token) => {
			if (token !== "admin") throw new Error("unauthorized");
		}, liveLogHub);
		sockets.attach(server);
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
		const port = (server.address() as AddressInfo).port;
		const ws = new WebSocket(`ws://127.0.0.1:${port}/api/logs/stream`);
		try {
			logRequest("snapshot-private-bearer");
			await new Promise<void>((resolve) => ws.once("open", resolve));
			const snapshot = new Promise<string>((resolve) => ws.once("message", (data) => resolve(data.toString())));
			ws.send(JSON.stringify({ type: "auth", token: "admin" }));
			const snapshotJson = await snapshot;
			expect(JSON.parse(snapshotJson)).toMatchObject({ type: "snapshot", entries: expect.arrayContaining([
				expect.objectContaining({ fields: expect.objectContaining({ event: "request.end", url: "/api/media", status: 500, duration: expect.any(Number) }) }),
			]) });
			expect(snapshotJson).not.toContain("snapshot-private-bearer");

			const live = new Promise<string>((resolve) => ws.once("message", (data) => resolve(data.toString())));
			logRequest("live-private-bearer");
			const liveJson = await live;
			expect(JSON.parse(liveJson)).toMatchObject({ type: "log", entry: { fields: { event: "request.end", url: "/api/media", status: 500 } } });
			expect(liveJson).not.toContain("live-private-bearer");
		} finally {
			ws.close();
			sockets.close();
			server.close();
			logger.appenders.delete("live-test");
		}
	});

	it.each([
		`00-${"0".repeat(32)}-${"1".repeat(16)}-01`,
		`00-${"a".repeat(32)}-${"0".repeat(16)}-01`,
		`00-${"a".repeat(32)}-${"1".repeat(16)}-01,00-${"b".repeat(32)}-${"2".repeat(16)}-01`,
		"invalid",
	])("does not accept invalid traceparent %s", (traceparent) => {
		const ctx = new DIContext({ id: "test" });
		ctx.request = { method: "GET", url: "/api/other", headers: { traceparent }, body: {}, query: {}, params: {} };
		expect(alterRequestLog("info", { event: "request.end" }, ctx)).not.toHaveProperty("trace_id");
	});
});
