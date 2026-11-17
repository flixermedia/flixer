import { describe, expect, it } from "vitest";
import { sanitizeLoggerManagementEvent } from "./sentryService.js";

describe("logger administration Sentry privacy", () => {
	it("removes request data and breadcrumbs while retaining the exception", () => {
		const event = sanitizeLoggerManagementEvent({
			tags: { sensitive_logger_management: "true" },
			request: { data: { manageToken: "secret" }, headers: { authorization: "secret" } },
			extra: { secret: "secret" },
			breadcrumbs: [{ message: "secret" }],
			exception: { values: [{ type: "Error", value: "logger unavailable" }] },
		});
		expect(JSON.stringify(event)).not.toContain("secret");
		expect(event.exception?.values?.[0]?.value).toBe("logger unavailable");
	});

	it("leaves other Sentry events unchanged", () => {
		const event = { request: { url: "/api/other" }, breadcrumbs: [{ message: "diagnostic" }] };
		expect(sanitizeLoggerManagementEvent(event)).toEqual(event);
	});
});
