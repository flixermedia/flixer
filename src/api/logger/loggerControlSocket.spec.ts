import { chmodSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppConfig, setAppConfig } from "../../config/store/appConfig.js";
import { aiSignature } from "../ai/aiAuth.js";
import { indexerSignature } from "../indexer/indexerAuth.js";
import { startLoggerControlSocket } from "./loggerControlSocket.js";

const originalSecret = process.env.APP_SECRET;
const secret = "test-shared-secret-with-at-least-32-bytes";

describe("protected logger control socket", () => {
	afterEach(() => {
		if (originalSecret === undefined) delete process.env.APP_SECRET;
		else process.env.APP_SECRET = originalSecret;
		setAppConfig(undefined);
	});

	it("authenticates each producer and never caches credentials", async () => {
		process.env.APP_SECRET = secret;
		setAppConfig(new AppConfig(null));
		const dir = mkdtempSync(join(tmpdir(), "logger-socket-"));
		const socketPath = join(dir, "control.sock");
		const issue = vi.fn(async () => ({ endpoint: "https://logger.example", token: "x".repeat(43), expiresAt: "2099-01-01T00:00:00Z" }));
		const server = await startLoggerControlSocket(socketPath, { producerIngestConfiguration: issue });
		const send = (path: string, headers: Record<string, string | string[]> = {}) => new Promise<{ status: number; body: string; cache: string | undefined }>((resolve, reject) => {
			const req = request({ socketPath, path, headers }, (res) => {
				let body = "";
				res.setEncoding("utf8");
				res.on("data", (chunk: string) => { body += chunk; });
				res.on("end", () => resolve({ status: res.statusCode ?? 0, body, cache: res.headers["cache-control"] }));
			});
			req.on("error", reject);
			req.end();
		});
		try {
			expect(statSync(socketPath).mode & 0o777).toBe(0o666);
			await expect(startLoggerControlSocket(socketPath, { producerIngestConfiguration: issue })).rejects.toThrow("already in use");
			const path = "/api/internal/logger/indexer";
			const timestamp = String(Math.floor(Date.now() / 1000));
			expect((await send(path)).status).toBe(401);
			expect(issue).not.toHaveBeenCalled();
			const signature = indexerSignature(secret, timestamp, "GET", path, new Uint8Array());
			expect((await send(path, { "x-indexer-timestamp": timestamp, "x-indexer-signature": [signature, signature] })).status).toBe(401);
			expect((await send(path, { "x-indexer-timestamp": timestamp, "x-indexer-signature": `${signature}junk` })).status).toBe(401);
			const response = await send(path, { "x-indexer-timestamp": timestamp, "x-indexer-signature": signature });
			expect(response.status).toBe(200);
			expect(response.cache).toBe("private, no-store");
			expect(JSON.parse(response.body)).toMatchObject({ endpoint: "https://logger.example" });
			expect(issue).toHaveBeenCalledWith("flixer-indexer");
			expect((await send(path + "?token=hidden", { "x-indexer-timestamp": timestamp, "x-indexer-signature": signature })).status).toBe(404);
			const aiPath = "/api/internal/ai/logger-configuration";
			const ai = aiSignature(secret, timestamp, "GET", aiPath, new Uint8Array());
			expect((await send(aiPath, { "x-flixer-ai-timestamp": timestamp, "x-flixer-ai-signature": ai })).status).toBe(200);
			expect(issue).toHaveBeenCalledWith("flixer-ai");
			issue.mockRejectedValueOnce(new Error("sensitive internal details"));
			const failed = await send(path, { "x-indexer-timestamp": timestamp, "x-indexer-signature": signature });
			expect(failed.status).toBe(503);
			expect(failed.body).not.toContain("sensitive internal details");
		} finally {
			await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("rejects unsafe directories and never overwrites an existing file", async () => {
		const dir = mkdtempSync(join(tmpdir(), "logger-socket-"));
		const path = join(dir, "control.sock");
		const logger = { producerIngestConfiguration: vi.fn() };
		try {
			chmodSync(dir, 0o777);
			await expect(startLoggerControlSocket(path, logger)).rejects.toThrow("protected");
			chmodSync(dir, 0o700);
			writeFileSync(path, "preserve");
			await expect(startLoggerControlSocket(path, logger)).rejects.toThrow("not an owned socket");
			expect(statSync(path).isFile()).toBe(true);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
