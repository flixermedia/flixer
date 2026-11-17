import { Inject, Injectable } from "@tsed/di";
import { LoggerService } from "../api/logger/loggerService.js";
import { loggerExporter } from "./loggerExporter.js";

@Injectable()
export class LoggerExportService {
	private timer?: ReturnType<typeof setTimeout>;
	private renewing = false;
	private stopped = true;

	constructor(@Inject(LoggerService) private readonly logger: LoggerService) {}

	$onReady(): void {
		this.stopped = false;
		try {
			this.logger.restoreExporter();
		} catch {
			process.stderr.write("Flixer logger: could not restore the exporter configuration\n");
		}
		this.renew();
	}

	async $onDestroy(): Promise<void> {
		this.stopped = true;
		if (this.timer) clearTimeout(this.timer);
		await loggerExporter.shutdown(2_000);
	}

	private renew(): void {
		if (this.stopped || this.renewing) return;
		this.renewing = true;
		void this.logger.renewIngestCredential().then(() => {
			this.schedule(60_000);
		}).catch(() => {
			process.stderr.write("Flixer logger: could not renew the ingestion credential\n");
			this.schedule(60_000 + Math.floor(Math.random() * 15_000));
		}).finally(() => {
			this.renewing = false;
		});
	}

	private schedule(delay: number): void {
		if (this.stopped) return;
		this.timer = setTimeout(() => this.renew(), delay);
		this.timer.unref();
	}
}
