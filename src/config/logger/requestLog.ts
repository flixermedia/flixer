import type { DIContext } from "@tsed/di";
import { defaultAlterLog } from "@tsed/platform-log-request";

/** Logger management requests can contain long-lived credentials. */
export function isLoggerManagementPath(url: string): boolean {
	const path = url.split("?")[0];
	return path === "/api/admin/logger" || path.startsWith("/api/admin/logger/") ||
		path === "/api/logs/web" || path === "/api/logs/web/" ||
		path === "/api/internal/ai/logger-configuration" ||
		path === "/api/internal/logger" || path.startsWith("/api/internal/logger/");
}

function requestTraceId(header: unknown): string | undefined {
	if (typeof header !== "string") return undefined;
	const match = /^00-([0-9a-f]{32})-([0-9a-f]{16})-[0-9a-f]{2}$/.exec(header);
	if (!match || match[1] === "0".repeat(32) || match[2] === "0".repeat(16)) return undefined;
	return match[1];
}

export function alterRequestLog(level: string, value: Record<string, unknown>, ctx: DIContext) {
	const requestUrl = typeof ctx.request.url === "string" ? ctx.request.url.split("?")[0] : "";
	const traceId = requestTraceId(ctx.request.headers?.traceparent);
	if (isLoggerManagementPath(requestUrl)) {
		return {
			method: ctx.request.method,
			url: requestUrl,
			event: value.event,
			status: value.status,
			state: value.state,
			...(traceId ? { trace_id: traceId } : {}),
		};
	}
	return { ...defaultAlterLog(level, value, ctx), ...(traceId ? { trace_id: traceId } : {}) };
}
