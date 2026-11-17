import { IncomingMessage } from "node:http";
import { Socket } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { aiSignature } from "../ai/aiAuth.js";
import { AppConfig, setAppConfig } from "../../config/store/appConfig.js";
import { AiLoggerController } from "./aiLoggerController.js";
import { LoggerService } from "./loggerService.js";

const secret = "test-shared-secret-with-at-least-32-bytes";
const path = "/api/internal/ai/logger-configuration";
const originalSecret = process.env.APP_SECRET;

describe("AI logger configuration endpoint", () => {
	afterEach(() => {
		if (originalSecret === undefined) delete process.env.APP_SECRET;
		else process.env.APP_SECRET = originalSecret;
		setAppConfig(undefined);
	});

	it("requires an authentic signature and a secure transport, and forbids caching", async () => {
		process.env.APP_SECRET = secret;
		setAppConfig(new AppConfig(null));
		const service = new LoggerService({ requireAdmin: vi.fn() });
		const getConfig = vi.spyOn(service, "producerIngestConfiguration").mockResolvedValue({
			endpoint: "https://logger.example", token: "x".repeat(43), expiresAt: "2099-01-01T00:00:00Z",
		});
		const controller = new AiLoggerController(service);
		const socket = new Socket();
		Object.defineProperty(socket, "remoteAddress", { value: "192.0.2.1", configurable: true });
		const setHeader = vi.fn();
		const ctx = { request: { req: new IncomingMessage(socket) }, response: { setHeader } };
		const timestamp = String(Math.floor(Date.now() / 1000));
		const signature = aiSignature(secret, timestamp, "GET", path, new Uint8Array());
		await expect(controller.configuration(ctx, timestamp, signature)).rejects.toThrow("TLS or a loopback");
		expect(getConfig).not.toHaveBeenCalled();
		Object.defineProperty(socket, "remoteAddress", { value: "127.0.0.1" });
		await expect(controller.configuration(ctx, timestamp, "invalid")).rejects.toThrow();
		expect(getConfig).not.toHaveBeenCalled();
		await expect(controller.configuration(ctx, timestamp, signature)).resolves.toMatchObject({ endpoint: "https://logger.example" });
		expect(setHeader).toHaveBeenCalledWith("Cache-Control", "private, no-store");
	});
});
