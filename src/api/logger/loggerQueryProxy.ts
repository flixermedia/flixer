import { Inject, Injectable } from "@tsed/di";
import { BadRequest, Exception } from "@tsed/exceptions";
import { Readable } from "node:stream";
import { appConfig } from "../../config/store/appConfig.js";
import { AuthService } from "../auth/authService.js";
import { LoggerService } from "./loggerService.js";

const paths = {
	recent: "/api/logs",
	stats: "/api/logs/stats",
	sources: "/api/logs/sources",
	errors: "/api/logs/errors",
	stream: "/api/logs/stream",
	search: "/api/logs/search",
} as const;
type QueryKind = keyof typeof paths;
type Ticket = { endpoint: string; token: string; expiresAt: string };

function isQueryKind(value: string): value is QueryKind {
	return Object.hasOwn(paths, value);
}

/** Mediates admin queries without exposing a logger credential to the browser. */
@Injectable()
export class LoggerQueryProxy {
	private cached?: { ticket: Ticket; management: string };
	private pending?: { promise: Promise<Ticket>; endpoint: string; management: string };

	constructor(
		@Inject(AuthService) private readonly auth: Pick<AuthService, "requireAdmin">,
		@Inject(LoggerService) private readonly logger: Pick<LoggerService, "issueQueryToken">,
	) {}

	private async ticket(authorization?: string): Promise<Ticket> {
		const store = appConfig().persistent;
		const endpoint = store?.get("loggerUrl");
		const management = store?.get("loggerManageToken");
		if (!endpoint || !management) throw new Exception(503, "The logger is not configured.");
		if (this.cached?.ticket.endpoint === endpoint && this.cached.management === management &&
			Date.parse(this.cached.ticket.expiresAt) > Date.now() + 10_000) return this.cached.ticket;
		if (!this.pending || this.pending.endpoint !== endpoint || this.pending.management !== management) {
			const promise = this.logger.issueQueryToken(authorization).then((ticket) => {
				if (store.get("loggerUrl") !== endpoint || store.get("loggerManageToken") !== management || ticket.endpoint !== endpoint) {
					throw new Exception(409, "Logger configuration changed during query authorization.");
				}
				this.cached = { ticket, management };
				return ticket;
			});
			const pending = { promise, endpoint, management };
			this.pending = pending;
			void promise.finally(() => {
				if (this.pending === pending) this.pending = undefined;
			}).catch(() => undefined);
		}
		return this.pending.promise;
	}

	async query(kind: string, search: string, body: unknown, cursor: string | undefined, authorization?: string, signal?: AbortSignal): Promise<{
		stream: Readable; contentType: string; abort: () => void;
	}> {
		await this.auth.requireAdmin(authorization);
		if (!isQueryKind(kind) || search.length > 4096 || (search && !search.startsWith("?"))) {
			throw new BadRequest("Invalid logger query.");
		}
		const selected = kind;
		if ((selected === "search") !== (body !== undefined)) throw new BadRequest("Invalid logger query method.");
		if (cursor && (selected !== "stream" || cursor.length > 4096 || /[\r\n]/.test(cursor))) {
			throw new BadRequest("Invalid logger cursor.");
		}
		const serialized = body === undefined ? undefined : JSON.stringify(body);
		if (serialized !== undefined && Buffer.byteLength(serialized) > 32_768) throw new BadRequest("Logger query is too large.");
		const ticket = await this.ticket(authorization);
		if (signal?.aborted) throw new Exception(503, "The logger query was cancelled.");
		const store = appConfig().persistent;
		const management = store?.get("loggerManageToken");
		if (!management || store?.get("loggerUrl") !== ticket.endpoint || this.cached?.ticket !== ticket ||
			this.cached.management !== management) {
			throw new Exception(409, "Logger configuration changed during query authorization.");
		}
		const controller = new AbortController();
		const requestSignal = signal ? AbortSignal.any([controller.signal, signal]) : controller.signal;
		let timer: ReturnType<typeof setTimeout> | undefined = setTimeout(() => controller.abort(), 15_000);
		let response: Response;
		try {
			response = await fetch(ticket.endpoint + paths[selected] + search, {
				method: body === undefined ? "GET" : "POST",
				headers: {
					authorization: `Bearer ${ticket.token}`,
					...(serialized === undefined ? {} : { "content-type": "application/json" }),
					...(cursor ? { "last-event-id": cursor } : {}),
				},
				body: serialized, signal: requestSignal, redirect: "error",
			});
		} catch {
			clearTimeout(timer);
			throw new Exception(503, "The logger query could not be completed.");
		}
		if (!response.ok || !response.body) {
			clearTimeout(timer);
			await response.body?.cancel();
			if (response.status === 401) this.cached = undefined;
			const status = response.status === 401 ? 503 : [400, 403, 409, 410, 422, 429, 503].includes(response.status) ? response.status : 502;
			throw new Exception(status, "The logger rejected the query.");
		}
		if (selected === "stream") {
			clearTimeout(timer);
			timer = undefined;
		}
		const reader = response.body.getReader();
		const stream = Readable.from((async function* () {
			let bytes = 0;
			try {
				for (;;) {
					const result = await reader.read();
					if (result.done) break;
					if (store.get("loggerUrl") !== ticket.endpoint || store.get("loggerManageToken") !== management) {
						controller.abort();
						throw new Error("Logger configuration changed during query.");
					}
					bytes += result.value.byteLength;
					if (selected !== "stream" && bytes > 16 * 1024 * 1024) throw new Error("Logger response exceeds the size limit.");
					yield result.value;
				}
			} finally {
				if (timer) clearTimeout(timer);
				await reader.cancel();
				reader.releaseLock();
			}
		})(), { objectMode: false });
		return { stream, contentType: selected === "stream" ? "text/event-stream" : "application/json", abort: () => controller.abort() };
	}
}
