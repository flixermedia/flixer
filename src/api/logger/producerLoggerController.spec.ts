import { IncomingMessage } from "node:http";
import { Socket } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppConfig, setAppConfig } from "../../config/store/appConfig.js";
import { indexerSignature } from "../indexer/indexerAuth.js";
import { LoggerService } from "./loggerService.js";
import { ProducerLoggerController } from "./producerLoggerController.js";

const secret = "test-shared-secret-with-at-least-32-bytes";
const originalSecret = process.env.APP_SECRET;

describe("producer logger configuration endpoint", () => {
	afterEach(() => {
		if (originalSecret === undefined) delete process.env.APP_SECRET;
		else process.env.APP_SECRET = originalSecret;
		setAppConfig(undefined);
	});

	it.each(["indexer", "streamer", "updater"])("authenticates and binds %s without caching", async (producer) => {
		process.env.APP_SECRET = secret;
		setAppConfig(new AppConfig(null));
		const service = new LoggerService({ requireAdmin: vi.fn() });
		const getConfig = vi.spyOn(service, "producerIngestConfiguration").mockResolvedValue({
			endpoint: "https://logger.example", token: "x".repeat(43), expiresAt: "2099-01-01T00:00:00Z",
		});
		const controller = new ProducerLoggerController(service);
		const socket = new Socket();
		Object.defineProperty(socket, "remoteAddress", { value: "192.0.2.1", configurable: true });
		const setHeader = vi.fn();
		const ctx = { request: { req: new IncomingMessage(socket) }, response: { setHeader } };
		const timestamp = String(Math.floor(Date.now() / 1000));
		const signature = indexerSignature(secret, timestamp, "GET", `/api/internal/logger/${producer}`, new Uint8Array());
		await expect(controller.configuration(ctx, producer, timestamp, signature)).rejects.toThrow("TLS or a loopback");
		expect(getConfig).not.toHaveBeenCalled();
		Object.defineProperty(socket, "remoteAddress", { value: "127.0.0.1" });
		await expect(controller.configuration(ctx, producer, timestamp, "invalid")).rejects.toThrow();
		await expect(controller.configuration(ctx, "unknown", timestamp, signature)).rejects.toThrow("Unknown logger producer");
		await expect(controller.configuration(ctx, producer, timestamp, signature)).resolves.toMatchObject({ endpoint: "https://logger.example" });
		expect(getConfig).toHaveBeenCalledWith(`flixer-${producer}`);
		expect(setHeader).toHaveBeenCalledWith("Cache-Control", "private, no-store");
	});
});
