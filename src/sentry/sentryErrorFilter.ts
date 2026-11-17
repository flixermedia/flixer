import { inject } from "@tsed/di";
import { Catch, ErrorFilter } from "@tsed/platform-exceptions";
import type { BaseContext } from "@tsed/di";
import { SentryService } from "./sentryService.js";
import { isLoggerManagementPath } from "../config/logger/requestLog.js";

/** Reports unexpected (5xx) errors to Sentry, then renders the default error response. */
@Catch(Error)
export class SentryErrorFilter extends ErrorFilter {

	override catch(error: any, ctx: BaseContext): void {
		const status = error?.status ?? error?.statusCode ?? 500;
		if (status >= 500) {
			inject(SentryService).captureException(error?.origin ?? error, {
				sensitiveRequest: typeof ctx.request.url === "string" && isLoggerManagementPath(ctx.request.url),
			});
		}

		super.catch(error, ctx);
	}
}
