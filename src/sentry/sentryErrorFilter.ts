import { inject } from "@tsed/di";
import { Catch, ErrorFilter } from "@tsed/platform-exceptions";
import type { BaseContext } from "@tsed/di";
import { SentryService } from "./sentryService.js";
import { isLoggerManagementPath } from "../config/logger/requestLog.js";
import { isPermissionError, PermissionAlertService } from "../api/notifications/permissionAlertService.js";

/** Reports unexpected (5xx) errors to Sentry and permission errors to admins, then renders the default error response. */
@Catch(Error)
export class SentryErrorFilter extends ErrorFilter {

	override catch(error: any, ctx: BaseContext): void {
		const underlying = error?.origin ?? error;
		if (isPermissionError(underlying)) {
			try {
				const alerts = inject(PermissionAlertService);
				const method = typeof ctx.request.method === "string" ? ctx.request.method : "REQUEST";
				const url = typeof ctx.request.url === "string" ? ctx.request.url : "";
				void alerts.reportError(underlying, { source: "flixer", operation: `${method} ${url}`.trim() }).catch(() => {});
			} catch {
				// Ignore when PermissionAlertService is unavailable in minimal test containers.
			}
		}
		const status = error?.status ?? error?.statusCode ?? 500;
		if (status >= 500) {
			inject(SentryService).captureException(underlying, {
				sensitiveRequest: typeof ctx.request.url === "string" && isLoggerManagementPath(ctx.request.url),
			});
		}

		super.catch(error, ctx);
	}
}
