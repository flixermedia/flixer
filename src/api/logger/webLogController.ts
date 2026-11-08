import { Controller, Injectable } from "@tsed/di";
import { BadRequest, ServiceUnavailable, TooManyRequests } from "@tsed/exceptions";
import { BodyParams, HeaderParams } from "@tsed/platform-params";
import { Enum, Post, Property, Required, Returns, Security } from "@tsed/schema";
import { webLoggerExporter } from "../../logs/loggerExporter.js";
import { AuthService } from "../auth/authService.js";
import { LoggerService } from "./loggerService.js";

const kinds = ["window-error", "unhandled-rejection", "vue-error"] as const;
const errorTypes = ["Error", "TypeError", "RangeError", "ReferenceError", "SyntaxError", "URIError", "Other"] as const;
type ErrorKind = typeof kinds[number];
type ErrorType = typeof errorTypes[number];

export class WebLogRequest {
	@Property()
	@Required()
	@Enum(...kinds)
	kind!: ErrorKind;

	@Property()
	@Required()
	@Enum(...errorTypes)
	errorType!: ErrorType;
}

@Injectable()
export class WebLogService {
	private configuration?: { endpoint: string; token: string; expiresAt: string };
	private readonly users = new Map<string, { count: number; reset: number }>();
	private global = { count: 0, reset: 0 };

	constructor(private readonly logger: LoggerService) {}

	async submit(userId: string, request: WebLogRequest): Promise<void> {
		if (!request || !kinds.includes(request.kind) || !errorTypes.includes(request.errorType) ||
			Object.keys(request).some((key) => key !== "kind" && key !== "errorType")) {
			throw new BadRequest("Invalid browser log event.");
		}
		const now = Date.now();
		for (const [id, entry] of this.users) if (entry.reset <= now) this.users.delete(id);
		const user = this.users.get(userId) ?? { count: 0, reset: now + 60_000 };
		if (this.global.reset <= now) this.global = { count: 0, reset: now + 60_000 };
		if (user.count >= 20 || this.global.count >= 300 || (!this.users.has(userId) && this.users.size >= 2000)) {
			throw new TooManyRequests("Browser logging rate limit exceeded.");
		}
		user.count++;
		this.users.set(userId, user);
		this.global.count++;
		const configuration = await this.logger.producerIngestConfiguration("flixer-web");
		if (!webLoggerExporter.status().enabled) {
			webLoggerExporter.configure(configuration);
			this.configuration = configuration;
		} else if (!this.configuration || this.configuration.endpoint !== configuration.endpoint ||
			this.configuration.token !== configuration.token || this.configuration.expiresAt !== configuration.expiresAt) {
			webLoggerExporter.renewCredential(configuration);
			this.configuration = configuration;
		}
		if (webLoggerExporter.status().queued >= 1000) throw new ServiceUnavailable("Browser logging queue is full.");
		webLoggerExporter.enqueue({
			time: new Date().toISOString(), level: "error", app: "flixer-web", source: request.kind,
			message: `Browser ${request.kind}: ${request.errorType}`,
			event: "WEB_CLIENT_ERROR",
		});
	}

	async $onDestroy(): Promise<void> {
		await webLoggerExporter.shutdown(2000);
	}
}

@Controller("/logs/web")
@Security("BearerAuth")
export class WebLogController {
	constructor(private readonly auth: AuthService, private readonly webLogs: WebLogService) {}

	@Post("/")
	@Returns(202, Object).Description("Browser event accepted for best-effort delivery.")
	async submit(@BodyParams() request: WebLogRequest, @HeaderParams("authorization") authorization?: string) {
		const user = await this.auth.getAuthenticatedUser(authorization);
		await this.webLogs.submit(user.id, request);
		return { accepted: true };
	}
}
