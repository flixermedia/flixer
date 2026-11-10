import { DIContext } from "@tsed/di";
import { describe, expect, it } from "vitest";
import { alterRequestLog, setLogSuccessfulApiRequests, shouldLogRequestResponse } from "./requestLog.js";

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
			headers: { authorization: "Bearer hidden" },
			body: { manageToken: "hidden" },
			query: { secret: "hidden" },
			params: {},
		};
		const result = alterRequestLog("error", { event: "request.end", status: 400, state: "KO", error_body: "hidden" }, ctx);
		expect(JSON.stringify(result)).not.toContain("hidden");
		expect(result).toEqual({ method: "PUT", url: "/api/admin/logger/configuration", event: "request.end", status: 400, state: "KO" });
	});

	it("preserves default logging for other routes", () => {
		const ctx = new DIContext({ id: "test" });
		ctx.request = { method: "GET", url: "/api/other", route: "/api/other", headers: {}, body: {}, query: {}, params: {} };
		expect(alterRequestLog("info", { event: "request.end" }, ctx)).toMatchObject({ event: "request.end", url: "/api/other" });
	});

	it.each(["/api/admin/oidc/clients", "/api/oidc/interaction/example/details", "/api/oauth/me/subscriptions"])("does not log OAuth credentials or interaction cookies at %s", (url) => {
		const ctx = new DIContext({ id: "oauth-test" });
		ctx.request = {
			method: "POST", url: `${url}?private-query=value`, headers: { authorization: "private-token", cookie: "private-cookie" },
			body: { secret: "private-secret" }, query: { "private-query": "value" }, params: {},
		};
		const result = alterRequestLog("error", { event: "request.end", status: 400, error_body: "private-error" }, ctx);
		expect(result).toMatchObject({ url, status: 400 });
		expect(JSON.stringify(result)).not.toContain("private");
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
			method: "PUT", url: "/api/admin/logger/configuration?secret=hidden", headers: {
				traceparent: `00-${"a".repeat(32)}-${"1".repeat(16)}-01`, authorization: "private",
			},
			body: { token: "private" }, query: { secret: "hidden" }, params: {},
		};
		const result = alterRequestLog("error", { event: "request.end", status: 400, error_body: "private" }, ctx);
		expect(result).toMatchObject({ trace_id: "a".repeat(32), url: "/api/admin/logger/configuration" });
		expect(JSON.stringify(result)).not.toContain("private");
		expect(JSON.stringify(result)).not.toContain("hidden");
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
