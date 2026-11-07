import { Inject, Injectable } from "@tsed/di";
import { LoggerService } from "./loggerService.js";

/** Attempts optional local development enrollment without delaying API startup. */
@Injectable()
export class LoggerLocalBootstrapService {
	private stopped = true;
	private timer?: ReturnType<typeof setTimeout>;
	private lastError = 0;

	constructor(@Inject(LoggerService) private readonly logger: LoggerService) {}

	$onReady(): void {
		const path = process.env.FLIXER_LOGGER_LOCAL_OWNER_FILE?.trim();
		if (!path) return;
		const endpoint = process.env.FLIXER_LOGGER_LOCAL_ENDPOINT?.trim() || "http://127.0.0.1:8098";
		this.stopped = false;
		this.attempt(path, endpoint);
	}

	$onDestroy(): void {
		this.stopped = true;
		if (this.timer) clearTimeout(this.timer);
	}

	private attempt(path: string, endpoint: string): void {
		if (this.stopped) return;
		void this.logger.bootstrapLocal(path, endpoint, () => this.stopped).then((done) => {
			this.retry(path, endpoint, done ? 60 * 60_000 : 30_000);
		}, (error: unknown) => {
			const now = Date.now();
			if (now - this.lastError >= 60_000) {
				process.stderr.write(`Flixer logger: local bootstrap unavailable: ${error instanceof Error ? error.message : "unknown error"}; retrying\n`);
				this.lastError = now;
			}
			this.retry(path, endpoint, 30_000);
		});
	}

	private retry(path: string, endpoint: string, delay: number): void {
		if (this.stopped) return;
		this.timer = setTimeout(() => this.attempt(path, endpoint), delay);
		this.timer.unref();
	}
}
