import { afterEach, describe, expect, it, vi } from "vitest";
import { LoggerService } from "../api/logger/loggerService.js";
import { LoggerExportService } from "./loggerExportService.js";
import { loggerExporter } from "./loggerExporter.js";

describe("logger exporter lifecycle", () => {
	afterEach(() => {
		loggerExporter.configure();
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it("retries failed renewal promptly, then checks the stored credential every minute", async () => {
		vi.useFakeTimers();
		vi.spyOn(Math, "random").mockReturnValue(0);
		vi.spyOn(process.stderr, "write").mockImplementation(() => true);
		const logger = new LoggerService({ requireAdmin: async () => undefined });
		vi.spyOn(logger, "restoreExporter").mockImplementation(() => undefined);
		const renew = vi.spyOn(logger, "renewIngestCredential")
			.mockRejectedValueOnce(new Error("offline"))
			.mockResolvedValue(undefined);
		const lifecycle = new LoggerExportService(logger);
		lifecycle.$onReady();
		await vi.advanceTimersByTimeAsync(59_999);
		expect(renew).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(1);
		expect(renew).toHaveBeenCalledTimes(2);
		await vi.advanceTimersByTimeAsync(60_000);
		expect(renew).toHaveBeenCalledTimes(3);
		await lifecycle.$onDestroy();
		await vi.advanceTimersByTimeAsync(60_000);
		expect(renew).toHaveBeenCalledTimes(3);
	});

	it("does not schedule another attempt when shutdown occurs during renewal", async () => {
		vi.useFakeTimers();
		const logger = new LoggerService({ requireAdmin: async () => undefined });
		vi.spyOn(logger, "restoreExporter").mockImplementation(() => undefined);
		let resolveRenewal!: () => void;
		const renew = vi.spyOn(logger, "renewIngestCredential").mockImplementation(() => new Promise<void>((resolve) => { resolveRenewal = resolve; }));
		const lifecycle = new LoggerExportService(logger);
		lifecycle.$onReady();
		await lifecycle.$onDestroy();
		resolveRenewal();
		await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
		expect(renew).toHaveBeenCalledOnce();
	});
});
