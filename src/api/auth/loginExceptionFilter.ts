import type { BaseContext } from "@tsed/di";
import { Exception } from "@tsed/exceptions";
import { Catch, ExceptionFilter } from "@tsed/platform-exceptions";

@Catch(Exception)
export class LoginExceptionFilter extends ExceptionFilter {
	override catch(error: Exception, ctx: BaseContext): void {
		const url = typeof ctx.request.url === "string" ? ctx.request.url.split("?")[0].replace(/\/$/, "") : "";
		if (url === "/api/auth/login" && error.status >= 400 && error.status < 500) {
			ctx.response
				.setHeaders(this.getHeaders(error))
				.contentType("application/json")
				.status(error.status)
				.body({ name: error.name, message: error.message, status: error.status });
			return;
		}
		super.catch(error, ctx);
	}
}