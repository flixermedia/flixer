import { afterEach, describe, expect, it, vi } from "vitest";
import { LoggerLocalBootstrapService } from "./loggerLocalBootstrapService.js";
import { LoggerService } from "./loggerService.js";

describe("local logger bootstrap lifecycle", () => {
	afterEach(() => {
		vi.unstubAllEnvs();
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it("retries asynchronously and stops retrying after shutdown", async () => {
		vi.useFakeTimers();
		vi.stubEnv("FLIXER_LOGGER_LOCAL_OWNER_FILE", "/private/owner");
		vi.spyOn(process.stderr, "write").mockImplementation(() => true);
		const logger = new LoggerService({ requireAdmin: async () => {} });
		const bootstrap = vi.spyOn(logger, "bootstrapLocal").mockRejectedValueOnce(new Error("not ready")).mockResolvedValue(false);
		const lifecycle = new LoggerLocalBootstrapService(logger);
		lifecycle.$onReady();
		await vi.advanceTimersByTimeAsync(30_000);
		expect(bootstrap).toHaveBeenCalledTimes(2);
		expect(bootstrap).toHaveBeenCalledWith("/private/owner", "http://127.0.0.1:8098", expect.any(Function));
		lifecycle.$onDestroy();
		await vi.advanceTimersByTimeAsync(60_000);
		expect(bootstrap).toHaveBeenCalledTimes(2);
	});

	it("continues periodic renewal checks after successful bootstrap", async () => {
		vi.useFakeTimers();
		vi.stubEnv("FLIXER_LOGGER_LOCAL_OWNER_FILE", "/private/owner");
		const logger = new LoggerService({ requireAdmin: async () => {} });
		const bootstrap = vi.spyOn(logger, "bootstrapLocal").mockResolvedValue(true);
		const lifecycle = new LoggerLocalBootstrapService(logger);
		lifecycle.$onReady();
		await vi.advanceTimersByTimeAsync(60 * 60_000);
		expect(bootstrap).toHaveBeenCalledTimes(2);
		lifecycle.$onDestroy();
		await vi.advanceTimersByTimeAsync(60 * 60_000);
		expect(bootstrap).toHaveBeenCalledTimes(2);
	});

	it("uses an explicitly configured internal HTTPS logger endpoint", () => {
		vi.stubEnv("FLIXER_LOGGER_LOCAL_OWNER_FILE", "/private/owner");
		vi.stubEnv("FLIXER_LOGGER_LOCAL_ENDPOINT", "https://logger:8098");
		const logger = new LoggerService({ requireAdmin: async () => {} });
		const bootstrap = vi.spyOn(logger, "bootstrapLocal").mockResolvedValue(false);
		const lifecycle = new LoggerLocalBootstrapService(logger);
		lifecycle.$onReady();
		expect(bootstrap).toHaveBeenCalledWith("/private/owner", "https://logger:8098", expect.any(Function));
		lifecycle.$onDestroy();
	});
});
